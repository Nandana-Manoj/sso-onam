// Offline-capable store for the sadya scanner.
//
// - Caches every flat pass (nonce -> counts) in IndexedDB so the rep can preview
//   "X of Y remaining" with no connectivity.
// - Redemptions are enqueued locally first (instant feedback even offline), then
//   a background syncer flushes them to redeem_sadya_pass. The server is the
//   source of truth; client_scan_id makes replays idempotent, and a queued scan
//   the server rejects (e.g. over capacity from another device) is surfaced as a
//   discrepancy for review rather than silently dropped.
//
// IndexedDB is used as a simple key/value blob store (cache + queue are small),
// loaded into memory on init and persisted whole on each change.
import { useEffect, useReducer } from 'react';
import { supabase } from './supabase';

const DB_NAME = 'sso-scan';
const STORE = 'kv';

export interface CachedPass {
  nonce: string;
  tower_name: string;
  flat_number: string;
  allowed_scans: number;
  redeemed_count: number; // server snapshot
  status: string;
}

export interface QueueItem {
  client_scan_id: string;
  nonce: string;
  count: number;
  label: string;
  ts: number;
  state: 'pending' | 'synced' | 'failed';
  result?: string; // server redeem_result once synced
  error?: string;  // app error message if the server rejected the call
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

type Listener = () => void;

class ScanStore {
  cache: Record<string, CachedPass> = {};
  queue: QueueItem[] = [];
  online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  cachedAt: number | null = null;
  ready = false;
  syncing = false;
  cacheError: string | null = null;

  private listeners = new Set<Listener>();
  private started = false;

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  private emit() { this.listeners.forEach((l) => l()); }

  async init() {
    if (this.started) { void this.sync(); void this.refresh(); return; }
    this.started = true;
    this.cache = (await idbGet<Record<string, CachedPass>>('cache')) ?? {};
    this.queue = (await idbGet<QueueItem[]>('queue')) ?? [];
    this.cachedAt = (await idbGet<number>('cachedAt')) ?? null;
    this.ready = true;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.emit();
    await this.sync();
    await this.refresh();
  }

  private onOnline = () => { this.online = true; this.emit(); void this.sync().then(() => this.refresh()); };
  private onOffline = () => { this.online = false; this.emit(); };

  // Pull a fresh snapshot of every flat pass for the active event.
  async refresh() {
    if (!navigator.onLine) return;
    const { data, error } = await supabase.rpc('list_sadya_passes');
    if (error) { this.cacheError = error.message; this.emit(); return; }
    const map: Record<string, CachedPass> = {};
    for (const r of (data as CachedPass[]) ?? []) map[r.nonce] = r;
    this.cache = map;
    this.cachedAt = Date.now();
    this.cacheError = null;
    await idbSet('cache', this.cache);
    await idbSet('cachedAt', this.cachedAt);
    this.emit();
  }

  // Remaining meals for a flat: server snapshot minus locally-queued (unsynced) scans.
  remaining(nonce: string): number | null {
    const p = this.cache[nonce];
    if (!p) return null;
    const pending = this.queue
      .filter((q) => q.nonce === nonce && q.state === 'pending')
      .reduce((s, q) => s + q.count, 0);
    return p.allowed_scans - p.redeemed_count - pending;
  }

  // Look up a pass for the preview. When online, read fresh from the server so
  // concurrent scanners on other devices see each other's redemptions; fall back
  // to the cached snapshot only when offline or on a network failure.
  async lookup(nonce: string): Promise<{ found: boolean; pass?: CachedPass; remaining?: number }> {
    if (navigator.onLine) {
      const { data, error } = await supabase.rpc('lookup_sadya_pass', { p_nonce: nonce });
      if (!error) {
        const row = (data as Array<CachedPass & { found: boolean }>)?.[0];
        if (!row?.found) return { found: false };
        const p: CachedPass = {
          nonce,
          tower_name: row.tower_name,
          flat_number: row.flat_number,
          allowed_scans: row.allowed_scans,
          redeemed_count: row.redeemed_count,
          status: row.status,
        };
        this.cache[nonce] = p;
        await idbSet('cache', this.cache);
        this.emit();
        return { found: true, pass: p, remaining: this.remaining(nonce) ?? undefined };
      }
      // error present (e.g. transient network) — fall through to the cache
    }
    const cached = this.cache[nonce];
    if (!cached) return { found: false };
    return { found: true, pass: cached, remaining: this.remaining(nonce) ?? undefined };
  }

  // Enqueue a redemption (optimistic — instant local feedback), then try to sync.
  async redeem(nonce: string, count: number, label: string): Promise<QueueItem> {
    const item: QueueItem = {
      client_scan_id: crypto.randomUUID(),
      nonce, count, label, ts: Date.now(), state: 'pending',
    };
    this.queue = [item, ...this.queue];
    await idbSet('queue', this.queue);
    this.emit();
    void this.sync();
    return item;
  }

  private patch(id: string, fields: Partial<QueueItem>) {
    this.queue = this.queue.map((q) => (q.client_scan_id === id ? { ...q, ...fields } : q));
  }

  // Flush pending redemptions oldest-first. A Postgres error (has .code) means the
  // server rejected the call — mark it failed and move on. A bare network error
  // (no .code) means we're offline — stop and leave the rest pending.
  async sync() {
    if (this.syncing || !navigator.onLine) return;
    const pending = this.queue.filter((q) => q.state === 'pending').sort((a, b) => a.ts - b.ts);
    if (pending.length === 0) return;
    this.syncing = true;
    this.emit();

    for (const item of pending) {
      const { data, error } = await supabase.rpc('redeem_sadya_pass', {
        p_nonce: item.nonce,
        p_count: item.count,
        p_device: navigator.userAgent.slice(0, 120),
        p_client_scan_id: item.client_scan_id,
      });
      if (error) {
        const code = (error as { code?: string }).code;
        if (code) { this.patch(item.client_scan_id, { state: 'failed', error: error.message }); continue; }
        break; // network failure — stay offline, keep pending
      }
      const row = (data as Array<{ result: string; redeemed_count: number }>)?.[0];
      this.patch(item.client_scan_id, { state: 'synced', result: row?.result });
      if (row && this.cache[item.nonce]) this.cache[item.nonce].redeemed_count = row.redeemed_count;
    }

    // Keep all pending + the most recent settled items; prune the rest.
    const settled = this.queue.filter((q) => q.state !== 'pending').sort((a, b) => b.ts - a.ts).slice(0, 30);
    const stillPending = this.queue.filter((q) => q.state === 'pending');
    this.queue = [...stillPending, ...settled].sort((a, b) => b.ts - a.ts);

    await idbSet('queue', this.queue);
    await idbSet('cache', this.cache);
    this.syncing = false;
    this.emit();
  }

  get pendingCount() { return this.queue.filter((q) => q.state === 'pending').length; }
  // Scans the server rejected after the fact (e.g. over capacity from another device).
  get discrepancies() { return this.queue.filter((q) => (q.state === 'synced' && q.result && q.result !== 'accepted') || q.state === 'failed'); }
}

export const scanStore = new ScanStore();

// Re-render a component whenever the store changes; inits the store on first mount.
export function useScanStore(): ScanStore {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const unsub = scanStore.subscribe(force);
    void scanStore.init();
    return unsub;
  }, []);
  return scanStore;
}
