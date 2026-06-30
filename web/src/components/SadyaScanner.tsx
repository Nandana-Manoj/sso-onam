import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import Stepper from './Stepper';
import { useScanStore, type CachedPass } from '../lib/scanStore';

const READER_ID = 'sadya-qr-reader';

function flatLabel(tower: string | null, flat: string | null): string {
  return [tower, flat].filter(Boolean).join(' · ') || 'Flat';
}

interface Preview {
  found: boolean;
  pass?: CachedPass;
  remaining?: number;
}

export default function SadyaScanner() {
  const store = useScanStore();

  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [result, setResult] = useState<{ ok: boolean; msg: string; queued: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const qrRef = useRef<Html5Qrcode | null>(null);
  const handlingRef = useRef(false);

  const stopCamera = useCallback(async () => {
    const qr = qrRef.current;
    if (qr) {
      try { await qr.stop(); } catch { /* not running */ }
      try { await qr.clear(); } catch { /* ignore */ }
    }
    qrRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => () => { void stopCamera(); }, [stopCamera]);

  const onScan = useCallback(async (text: string) => {
    if (handlingRef.current) return;
    handlingRef.current = true;
    await stopCamera();
    setError(null);
    setResult(null);
    setNonce(text);
    setBusy(true);
    const res = await store.lookup(text);
    setBusy(false);
    handlingRef.current = false;
    setPreview(res);
    if (res.found) setCount(Math.max(1, res.remaining ?? 1));
  }, [stopCamera, store]);

  async function startCamera() {
    setError(null);
    setResult(null);
    setPreview(null);
    setNonce(null);
    try {
      const qr = new Html5Qrcode(READER_ID, { verbose: false });
      qrRef.current = qr;
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => { void onScan(decoded); },
        () => { /* per-frame decode misses — ignore */ },
      );
      setScanning(true);
    } catch (err) {
      qrRef.current = null;
      setError(err instanceof Error ? err.message : 'Could not start the camera. Check camera permissions.');
    }
  }

  async function redeem() {
    if (!nonce || !preview?.found) return;
    setBusy(true);
    setError(null);
    await store.redeem(nonce, count, flatLabel(preview.pass?.tower_name ?? null, preview.pass?.flat_number ?? null));
    setBusy(false);
    const left = store.remaining(nonce) ?? 0;
    setResult({
      ok: true,
      queued: !store.online,
      msg: `Served ${count} — ${left} left.`,
    });
    setPreview(null);
    setNonce(null);
  }

  function reset() {
    setResult(null);
    setError(null);
    setPreview(null);
    setNonce(null);
  }

  const nothingLeft = preview?.found && (preview.remaining ?? 0) <= 0;
  const recent = [...store.queue].sort((a, b) => b.ts - a.ts).slice(0, 10);

  return (
    <div>
      {/* Connectivity / sync status */}
      <div className="card between" style={{ alignItems: 'center' }}>
        <div>
          <span className={`badge soft ${store.online ? 'verified' : 'pending'}`}>
            {store.online ? 'Online' : 'Offline'}
          </span>{' '}
          {store.pendingCount > 0
            ? <span className="muted">{store.pendingCount} waiting to sync{store.syncing ? '…' : ''}</span>
            : <span className="muted">All scans synced</span>}
        </div>
        <span className="muted" style={{ fontSize: '0.85em' }}>
          {store.cachedAt ? `Passes cached ${new Date(store.cachedAt).toLocaleTimeString()}` : 'Caching…'}
        </span>
      </div>

      {/* Over-served / rejected scans flagged for review */}
      {store.discrepancies.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger, #c0392b)' }}>
          <strong className="error">Needs review ({store.discrepancies.length})</strong>
          <ul className="list" style={{ marginTop: '0.4rem' }}>
            {store.discrepancies.map((d) => (
              <li key={d.client_scan_id} className="muted" style={{ fontSize: '0.9em' }}>
                {d.label} — served {d.count} but {d.error ?? (d.result === 'rejected_exhausted' ? 'over capacity' : d.result)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Camera viewport — html5-qrcode injects the <video> here. The div must be
          laid out (not display:none) BEFORE start() so the lib can size the video. */}
      <div className="card" style={{ padding: scanning ? '0.4rem' : undefined }}>
        <div
          id={READER_ID}
          style={{ width: '100%', maxWidth: 360, margin: '0 auto', borderRadius: 10, overflow: 'hidden' }}
        />

        {scanning && (
          <>
            <p className="muted" style={{ textAlign: 'center', margin: '0.5rem 0 0' }}>
              📷 Point at the flat's QR — it captures automatically.
            </p>
            <button className="secondary" style={{ marginTop: '0.5rem' }} onClick={() => void stopCamera()}>
              Stop
            </button>
          </>
        )}

        {!scanning && !preview && !result && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Point the camera at a flat's sadya QR. Then set how many people from that flat are being served now —
              you can scan the same flat again later for anyone who arrives afterward.
            </p>
            <button onClick={startCamera} disabled={busy}>📷 Start Scanning</button>
          </>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {/* Preview after a successful scan */}
      {preview && !preview.found && (
        <div className="card card-accent">
          <p className="error" style={{ marginTop: 0 }}>Not a valid sadya pass.</p>
          <button onClick={() => void startCamera()}>Scan Again</button>
        </div>
      )}

      {preview?.found && (
        <div className="card card-accent">
          <h3 style={{ marginTop: 0 }}>{flatLabel(preview.pass?.tower_name ?? null, preview.pass?.flat_number ?? null)}</h3>
          <p className="muted" style={{ margin: '0.2rem 0 0.6rem' }}>
            {(preview.pass?.allowed_scans ?? 0) - (preview.remaining ?? 0)} of {preview.pass?.allowed_scans} already served ·{' '}
            <strong>{preview.remaining} remaining</strong>
          </p>

          {nothingLeft ? (
            <>
              <p className="error">This flat's pass is fully redeemed.</p>
              <button className="secondary" onClick={() => void startCamera()}>Scan Next</button>
            </>
          ) : (
            <>
              <label>Serving now
                <Stepper value={count} onChange={setCount} min={1} max={preview.remaining ?? 1} />
              </label>
              <div className="row" style={{ marginTop: '0.6rem' }}>
                <button className="success-btn" disabled={busy} onClick={redeem}>Redeem {count}</button>
                <button className="secondary" disabled={busy} onClick={() => void startCamera()}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Result of the last redemption */}
      {result && (
        <div className="card card-accent">
          <p className={result.ok ? 'success' : 'error'} style={{ marginTop: 0, fontWeight: 600 }}>
            {result.ok ? '✓ ' : '✗ '}{result.msg}
            {result.queued && <span className="muted" style={{ fontWeight: 400 }}> (saved — will sync when online)</span>}
          </p>
          <button onClick={() => void startCamera()}>Scan Next</button>{' '}
          <button className="secondary" onClick={reset}>Done</button>
        </div>
      )}

      {/* Recent scans */}
      {recent.length > 0 && (
        <>
          <div className="section-title"><h3>Recent Scans</h3></div>
          <ul className="list">
            {recent.map((s) => (
              <li key={s.client_scan_id} className="card between">
                <div>
                  <strong>{s.label}</strong>
                  <div className="muted">{new Date(s.ts).toLocaleTimeString()}</div>
                </div>
                <span className={`badge soft ${
                  s.state === 'pending' ? 'pending'
                  : s.result === 'accepted' ? 'verified'
                  : 'rejected'
                }`}>
                  {s.state === 'pending' ? `Served ${s.count} · syncing`
                    : s.result === 'accepted' ? `Served ${s.count}`
                    : s.error ? 'failed' : (s.result ?? 'done').replace('rejected_', '')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
