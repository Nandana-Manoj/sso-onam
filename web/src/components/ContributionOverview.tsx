import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/format';
import { downloadCsv } from '../lib/ui';
import { Donut } from './Charts';
import Modal from './Modal';
import type { ContributionStatus } from '../lib/types';

const ROWS_PREVIEW = 15;

export interface OverviewTower { id: string; name: string }
export interface OverviewFlat { id: string; tower_id: string; flat_number: string }
export interface OverviewContrib {
  id: string;
  flat_id: string;
  paid_to_tower_id: string;
  status: ContributionStatus;
  amount: number;
  amount_paid: number | null;
  refund_state?: 'requested' | 'refunded' | null;
}

type RowState = 'verified' | 'awaiting' | 'refunded';
type FlatState = RowState | 'none';
const STATE_LABEL: Record<FlatState, string> = {
  verified: 'Verified', awaiting: 'Awaiting Approval', refunded: 'Refunded', none: 'Not Started',
};

/** Effective state of a single contribution (refunded is its own state). Only
 *  three payment states are surfaced; a started/rejected/expired one counts as
 *  no payment yet ('none'). */
function effState(c: OverviewContrib): FlatState {
  if (c.refund_state === 'refunded') return 'refunded';
  return c.status === 'verified' ? 'verified'
    : c.status === 'submitted' ? 'awaiting' : 'none';
}
const cAmt = (c: OverviewContrib) => Number(c.amount_paid ?? c.amount);

/** Shared contributions dashboard. The table + donut are contribution-level (a
 *  ledger), so every refund stays visible and the numbers reconcile. */
export default function ContributionOverview({
  towers, flats, contribs,
}: { towers: OverviewTower[]; flats: OverviewFlat[]; contribs: OverviewContrib[] }) {
  // contribution-level counts (each contribution is one slice)
  const counts = { verified: 0, awaiting: 0, refunded: 0 };
  const flatsWithActivity = new Set<string>();
  const flatsPaid = new Set<string>();
  for (const c of contribs) {
    const st = effState(c);
    if (st === 'none') continue;
    flatsWithActivity.add(c.flat_id);
    if (st === 'verified') { counts.verified += 1; flatsPaid.add(c.flat_id); }
    else if (st === 'awaiting') counts.awaiting += 1;
    else if (st === 'refunded') counts.refunded += 1;
  }
  const notStarted = Math.max(0, flats.length - flatsWithActivity.size);

  const verifiedTotal = contribs
    .filter((c) => c.status === 'verified' && c.refund_state !== 'refunded')
    .reduce((s, c) => s + cAmt(c), 0);
  const refundedTotal = contribs.filter((c) => c.refund_state === 'refunded').reduce((s, c) => s + cAmt(c), 0);

  const collectedByTower = new Map<string, number>();
  for (const c of contribs) {
    if (c.status !== 'verified' || c.refund_state === 'refunded') continue;
    collectedByTower.set(c.paid_to_tower_id, (collectedByTower.get(c.paid_to_tower_id) ?? 0) + cAmt(c));
  }
  const maxTower = Math.max(1, ...towers.map((t) => collectedByTower.get(t.id) ?? 0));
  const pctPaid = flats.length ? Math.round((flatsPaid.size / flats.length) * 100) : 0;

  return (
    <>
      <div className="grid cols-3">
        <div className="stat green">
          <div className="stat-value">{formatINR(verifiedTotal)}</div>
          <div className="stat-label">Collected (Verified)</div>
        </div>
        <div className="stat blue">
          <div className="stat-value">{counts.awaiting}</div>
          <div className="stat-label">Awaiting Verification</div>
        </div>
        <div className="stat amber">
          <div className="stat-value">{flatsPaid.size}</div>
          <div className="stat-label">{flatsPaid.size === 1 ? 'Flat Paid' : 'Flats Paid'}</div>
        </div>
        {(refundedTotal > 0 || counts.refunded > 0) && (
          <div className="stat red">
            <div className="stat-value">{formatINR(refundedTotal)}</div>
            <div className="stat-label">Refunded ({counts.refunded})</div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Contribution Status</h3>
        <Donut
          segments={[
            { value: counts.verified, color: '#15803d', label: 'Verified' },
            { value: counts.awaiting, color: '#1d4ed8', label: 'Awaiting Approval' },
            { value: counts.refunded, color: '#b91c1c', label: 'Refunded' },
            { value: notStarted, color: '#e7d8bf', label: 'Not Started' },
          ]}
          centerLabel={flats.length ? `${pctPaid}%` : '—'}
          centerSub="Paid"
        />
      </div>

      <LedgerTable towers={towers} flats={flats} contribs={contribs} collectedByTower={collectedByTower} />

      <div className="card">
        <h3>Amount Collected by Tower</h3>
        {towers.map((t) => {
          const total = collectedByTower.get(t.id) ?? 0;
          const pct = total > 0 ? Math.max((total / maxTower) * 100, 4) : 0;
          return (
            <div className="bar-row" key={t.id}>
              <span className="bar-name">{t.name}</span>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${pct}%` }} /></span>
              <span className="bar-val">{formatINR(total)}</span>
            </div>
          );
        })}
        {towers.length === 0 && <p className="muted">No towers yet.</p>}
      </div>
    </>
  );
}

function LedgerTable({
  towers, flats, contribs, collectedByTower,
}: {
  towers: OverviewTower[];
  flats: OverviewFlat[];
  contribs: OverviewContrib[];
  collectedByTower: Map<string, number>;
}) {
  const [towerFilter, setTowerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RowState>('all');
  const [expanded, setExpanded] = useState(false);
  const [residentsBusy, setResidentsBusy] = useState(false);
  const [residentsErr, setResidentsErr] = useState<string | null>(null);
  const multiTower = towers.length > 1;
  const towerName = (id: string) => towers.find((t) => t.id === id)?.name ?? '—';
  const flatInfo = new Map(flats.map((f) => [f.id, f]));
  // A flat can carry more than one contribution row over time (a rejected
  // attempt followed by a fresh, successful one) — the query has no ORDER BY,
  // so pick whichever row is actually counted (verified/awaiting/refunded)
  // over a stale terminal one, regardless of which the DB happens to return last.
  const contribByFlat = new Map<string, OverviewContrib>();
  for (const c of contribs) {
    const cur = contribByFlat.get(c.flat_id);
    if (!cur || effState(cur) === 'none') contribByFlat.set(c.flat_id, c);
  }

  const rows = contribs
    .map((c) => ({ id: c.id, flat: flatInfo.get(c.flat_id)?.flat_number ?? '—', towerId: c.paid_to_tower_id, st: effState(c), amt: cAmt(c) }))
    .filter((r) => r.st !== 'none')
    .filter((r) => towerFilter === 'all' || r.towerId === towerFilter)
    .filter((r) => statusFilter === 'all' || r.st === statusFilter)
    .sort((a, b) =>
      a.towerId === b.towerId
        ? a.flat.localeCompare(b.flat, undefined, { numeric: true })
        : towerName(a.towerId).localeCompare(towerName(b.towerId), undefined, { numeric: true }),
    );

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `onam-contributions-${stamp}.csv`,
      ['Tower', 'Flat', 'Status', 'Amount (Rs.)'],
      rows.map((r) => [towerName(r.towerId), r.flat, STATE_LABEL[r.st], r.amt]),
    );
  }

  /** Full resident roster (not just flats with a contribution) — one row per
   *  person, scoped to whichever towers this dashboard already covers (all
   *  towers for admins, just the rep's own towers for reps, via RLS). */
  async function exportResidentsCsv() {
    setResidentsBusy(true);
    setResidentsErr(null);
    const { data, error } = await supabase
      .from('profiles')
      .select('name, mobile, tower_id, flat_id, claimed')
      .in('tower_id', towers.map((t) => t.id));
    setResidentsBusy(false);
    if (error) { setResidentsErr(error.message); return; }

    type ResidentRow = { name: string; mobile: string; tower_id: string | null; flat_id: string | null; claimed: boolean };
    const rows = ((data as ResidentRow[]) ?? [])
      .map((p) => {
        const flat = p.flat_id ? flatInfo.get(p.flat_id) : undefined;
        const c = flat ? contribByFlat.get(flat.id) : undefined;
        const st = c ? effState(c) : 'none';
        return {
          tower: towerName(p.tower_id ?? ''),
          flat: flat?.flat_number ?? '—',
          name: p.name,
          mobile: p.mobile,
          registered: p.claimed ? 'Yes' : 'No',
          status: STATE_LABEL[st],
          // Only a counted (verified/awaiting/refunded) contribution has a real
          // paid amount — a payment_pending/rejected/expired row's `amount` is
          // just the pledge, not money actually collected, so it must read 0.
          amount: c && st !== 'none' ? cAmt(c) : 0,
        };
      })
      .sort((a, b) => a.tower.localeCompare(b.tower, undefined, { numeric: true }) || a.flat.localeCompare(b.flat, undefined, { numeric: true }));

    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `onam-residents-${stamp}.csv`,
      ['Tower', 'Flat', 'Name', 'Mobile', 'Registered', 'Contribution Status', 'Amount (Rs.)'],
      rows.map((r) => [r.tower, r.flat, r.name, r.mobile, r.registered, r.status, r.amount]),
      "Amount is the flat's total contribution, repeated on every resident of that flat — do not sum this column. For collection totals, use Download Contributions CSV instead.",
    );
  }

  const collectedTotal = towerFilter === 'all'
    ? [...collectedByTower.values()].reduce((s, v) => s + v, 0)
    : collectedByTower.get(towerFilter) ?? 0;

  const filters = (
    <div className="row" style={{ marginBottom: '0.6rem' }}>
      {multiTower && (
        <select value={towerFilter} onChange={(e) => setTowerFilter(e.target.value)} style={{ flex: 1 }}>
          <option value="all">All Towers</option>
          {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | RowState)} style={{ flex: 1 }}>
        <option value="all">All Statuses</option>
        <option value="verified">Verified</option>
        <option value="awaiting">Awaiting Approval</option>
        <option value="refunded">Refunded</option>
      </select>
    </div>
  );

  const renderTable = (visible: typeof rows) => (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Flat</th>
            {multiTower && <th>Tower</th>}
            <th>Status</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.id}>
              <td>{r.flat}</td>
              {multiTower && <td>{towerName(r.towerId)}</td>}
              <td><span className={`badge soft ${r.st}`}>{STATE_LABEL[r.st]}</span></td>
              <td>{r.amt ? formatINR(r.amt) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Total Collected</th>
            {multiTower && <th />}
            <th />
            <th>{formatINR(collectedTotal)}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  const emptyMsg = (
    <p className="muted">
      {towerFilter !== 'all' || statusFilter !== 'all' ? 'No contributions match these filters.' : 'No contributions yet.'}
    </p>
  );
  const hasOverflow = rows.length > ROWS_PREVIEW;

  return (
    <div className="card">
      <h3>Flats &amp; Amounts</h3>
      <div className="row" style={{ margin: '0.6rem 0' }}>
        <button className="secondary" style={{ flex: 1 }} disabled={rows.length === 0} onClick={exportCsv}>
          Download Contributions CSV
        </button>
        <button className="secondary" style={{ flex: 1 }} disabled={residentsBusy} onClick={exportResidentsCsv}>
          {residentsBusy ? 'Preparing…' : 'Download Residents CSV'}
        </button>
      </div>
      {residentsErr && <p className="error">{residentsErr}</p>}
      {filters}
      {rows.length === 0 ? emptyMsg : renderTable(rows.slice(0, ROWS_PREVIEW))}
      {hasOverflow && (
        <button type="button" className="secondary" style={{ width: '100%' }} onClick={() => setExpanded(true)}>
          Show All {rows.length} →
        </button>
      )}

      {expanded && (
        <Modal title="Flats & Amounts" onClose={() => setExpanded(false)} wide>
          <div className="between" style={{ marginBottom: '0.4rem' }}>
            <span className="muted">{rows.length} contribution{rows.length === 1 ? '' : 's'}</span>
            <button className="secondary" disabled={rows.length === 0} onClick={exportCsv}>Download Contributions CSV</button>
          </div>
          {filters}
          {rows.length === 0 ? emptyMsg : renderTable(rows)}
        </Modal>
      )}
    </div>
  );
}
