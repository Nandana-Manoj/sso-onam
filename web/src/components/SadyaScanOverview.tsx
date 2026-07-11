import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { downloadCsv } from '../lib/ui';
import { Donut } from './Charts';
import type { QrStatus } from '../lib/types';

// One QR pass per flat (RLS scopes the query: admins see all towers, a rep sees
// only flats in the towers they manage).
interface PassRow {
  id: string;
  allowed_scans: number;
  redeemed_count: number;
  status: QrStatus;
  flats: { flat_number: string; tower_id: string; towers: { name: string } | null } | null;
}

interface TowerRoll {
  towerId: string;
  towerName: string;
  flats: number;        // flats with a live (non-void) pass
  booked: number;       // meals allowed across those passes
  redeemed: number;     // meals actually scanned/served
  fullyServed: number;  // flats whose pass is fully redeemed
  notScanned: number;   // flats whose pass hasn't been scanned at all
}

const STATUS_LABEL: Record<QrStatus, string> = {
  issued: 'Not Scanned',
  partially_redeemed: 'Partly Served',
  fully_redeemed: 'Fully Served',
  void: 'Void',
};

/** Sadya serving dashboard — how the event-day QR scanning is going. Reads the
 *  flat QR passes (allowed vs redeemed) so admins/reps can see meals served,
 *  meals still to come, and which flats have and haven't been scanned. */
export default function SadyaScanOverview({
  eventId, servingOpen,
}: { eventId: string; servingOpen?: boolean }) {
  const [passes, setPasses] = useState<PassRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('qr_passes')
      .select('id, allowed_scans, redeemed_count, status, flats(flat_number, tower_id, towers(name))')
      .eq('event_id', eventId);
    if (e) setError(e.message);
    setPasses((data as unknown as PassRow[]) ?? []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // Void passes are cancelled bookings — exclude them from serving totals.
  const live = passes.filter((p) => p.status !== 'void');
  const booked = live.reduce((s, p) => s + p.allowed_scans, 0);
  const redeemed = live.reduce((s, p) => s + p.redeemed_count, 0);
  const remaining = Math.max(0, booked - redeemed);
  const flatsTotal = live.length;
  const flatsFullyServed = live.filter((p) => p.status === 'fully_redeemed').length;
  const flatsPartial = live.filter((p) => p.status === 'partially_redeemed').length;
  const flatsNotScanned = live.filter((p) => p.status === 'issued').length;

  // Roll up per tower for the breakdown table.
  const byTower = new Map<string, TowerRoll>();
  for (const p of live) {
    const towerId = p.flats?.tower_id ?? '—';
    const towerName = p.flats?.towers?.name ?? '—';
    let r = byTower.get(towerId);
    if (!r) {
      r = { towerId, towerName, flats: 0, booked: 0, redeemed: 0, fullyServed: 0, notScanned: 0 };
      byTower.set(towerId, r);
    }
    r.flats += 1;
    r.booked += p.allowed_scans;
    r.redeemed += p.redeemed_count;
    if (p.status === 'fully_redeemed') r.fullyServed += 1;
    if (p.status === 'issued') r.notScanned += 1;
  }
  const towerRolls = [...byTower.values()].sort((a, b) =>
    a.towerName.localeCompare(b.towerName, undefined, { numeric: true }));

  // Per-flat rows, sorted the same way as the tower rollup, for the flat
  // search and the flat-level CSV export.
  const flatRows = live.slice().sort((a, b) =>
    (a.flats?.towers?.name ?? '').localeCompare(b.flats?.towers?.name ?? '', undefined, { numeric: true })
    || (a.flats?.flat_number ?? '').localeCompare(b.flats?.flat_number ?? '', undefined, { numeric: true }));

  const searchQuery = search.trim().toLowerCase();
  const searchMatches = searchQuery
    ? flatRows.filter((p) => (p.flats?.flat_number ?? '').toLowerCase().includes(searchQuery))
    : [];

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `onam-sadya-serving-${stamp}.csv`,
      ['Tower', 'Flats', 'Meals Booked', 'Meals Served', 'Remaining', 'Flats Fully Served', 'Flats Not Scanned'],
      towerRolls.map((r) => [r.towerName, r.flats, r.booked, r.redeemed, r.booked - r.redeemed, r.fullyServed, r.notScanned]),
    );
  }

  /** Per-flat sadya CSV — same RLS-scoped `passes` data as the tower rollup,
   *  so an admin gets the whole society and a rep gets only their tower(s). */
  function exportFlatsCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `onam-sadya-flats-${stamp}.csv`,
      ['Tower', 'Flat', 'Meals Booked', 'Meals Served', 'Remaining', 'Status'],
      flatRows.map((p) => [
        p.flats?.towers?.name ?? '—',
        p.flats?.flat_number ?? '—',
        p.allowed_scans,
        p.redeemed_count,
        Math.max(0, p.allowed_scans - p.redeemed_count),
        STATUS_LABEL[p.status],
      ]),
    );
  }

  if (loading) return <div className="card"><p className="muted">Loading serving data…</p></div>;
  if (error) return <div className="card"><p className="error">{error}</p></div>;
  if (flatsTotal === 0) {
    return (
      <div className="card">
        <h3>Sadya Serving</h3>
        <p className="muted" style={{ margin: 0 }}>
          No sadya passes issued yet. Passes appear here once bookings are verified.
        </p>
      </div>
    );
  }

  const servedPct = booked > 0 ? Math.round((redeemed / booked) * 100) : 0;

  return (
    <>
      <div className="section-title">
        <h3>Sadya Serving</h3>
        {servingOpen !== undefined && (
          <span className={`badge soft ${servingOpen ? 'verified' : 'pending'}`}>
            {servingOpen ? 'Serving Open' : 'Serving Closed'}
          </span>
        )}
      </div>

      <div className="grid cols-3">
        <div className="stat green">
          <div className="stat-value">{redeemed}</div>
          <div className="stat-label">{redeemed === 1 ? 'Meal' : 'Meals'} Served ({servedPct}%)</div>
        </div>
        <div className="stat amber">
          <div className="stat-value">{remaining}</div>
          <div className="stat-label">{remaining === 1 ? 'Meal' : 'Meals'} Remaining</div>
        </div>
        <div className="stat blue">
          <div className="stat-value">{booked}</div>
          <div className="stat-label">{booked === 1 ? 'Meal' : 'Meals'} Booked</div>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat green">
          <div className="stat-value">{flatsFullyServed}</div>
          <div className="stat-label">{flatsFullyServed === 1 ? 'Flat' : 'Flats'} Fully Served</div>
        </div>
        <div className="stat amber">
          <div className="stat-value">{flatsPartial}</div>
          <div className="stat-label">{flatsPartial === 1 ? 'Flat' : 'Flats'} Partly Served</div>
        </div>
        <div className="stat blue">
          <div className="stat-value">{flatsNotScanned}</div>
          <div className="stat-label">{flatsNotScanned === 1 ? 'Flat' : 'Flats'} Not Yet Scanned</div>
        </div>
      </div>

      <div className="card">
        <h3>Meals Served vs Remaining</h3>
        <Donut
          segments={[
            { value: redeemed, color: '#15803d', label: 'Served' },
            { value: remaining, color: '#b45309', label: 'Remaining' },
          ]}
          centerLabel={String(booked)}
          centerSub="Meals"
        />
      </div>

      <div className="card">
        <h3>Search Flats</h3>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by flat number…"
        />
        {searchQuery && (
          searchMatches.length === 0 ? (
            <p className="muted" style={{ marginTop: '0.6rem' }}>No matching flat.</p>
          ) : (
            <div className="tbl-wrap" style={{ marginTop: '0.6rem' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Flat</th>
                    <th>Tower</th>
                    <th>Served</th>
                    <th>Remaining to be served</th>
                  </tr>
                </thead>
                <tbody>
                  {searchMatches.map((p) => (
                    <tr key={p.id}>
                      <td>{p.flats?.flat_number ?? '—'}</td>
                      <td>{p.flats?.towers?.name ?? '—'}</td>
                      <td>{p.redeemed_count}{p.allowed_scans ? ` / ${p.allowed_scans}` : ''}</td>
                      <td>{Math.max(0, p.allowed_scans - p.redeemed_count) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <div className="card">
        <h3>By Tower</h3>
        <div className="row" style={{ margin: '0.6rem 0' }}>
          <button className="secondary" style={{ flex: 1 }} disabled={towerRolls.length === 0} onClick={exportCsv}>
            Download Tower CSV
          </button>
          <button className="secondary" style={{ flex: 1 }} disabled={flatRows.length === 0} onClick={exportFlatsCsv}>
            Download Flats CSV
          </button>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tower</th>
                <th>Flats</th>
                <th>Served</th>
                <th>Remaining to be served</th>
              </tr>
            </thead>
            <tbody>
              {towerRolls.map((r) => (
                <tr key={r.towerId}>
                  <td>{r.towerName}</td>
                  <td>{r.flats}</td>
                  <td>{r.redeemed}{r.booked ? ` / ${r.booked}` : ''}</td>
                  <td>{Math.max(0, r.booked - r.redeemed) || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <th>{flatsTotal}</th>
                <th>{redeemed} / {booked}</th>
                <th>{remaining}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
