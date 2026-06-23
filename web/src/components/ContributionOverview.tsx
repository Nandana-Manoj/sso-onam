import { useState } from 'react';
import { formatINR } from '../lib/format';
import { downloadCsv } from '../lib/ui';
import { Donut } from './Charts';
import type { ContributionStatus } from '../lib/types';

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

type RowState = 'verified' | 'awaiting' | 'pending' | 'refunded';
type FlatState = RowState | 'none';
const STATE_LABEL: Record<FlatState, string> = {
  verified: 'Verified', awaiting: 'Awaiting', pending: 'Started', refunded: 'Refunded', none: 'Not started',
};

/** Effective state of a single contribution (refunded is its own state). */
function effState(c: OverviewContrib): FlatState {
  if (c.refund_state === 'refunded') return 'refunded';
  return c.status === 'verified' ? 'verified'
    : c.status === 'submitted' ? 'awaiting'
    : c.status === 'payment_pending' ? 'pending' : 'none';
}
const cAmt = (c: OverviewContrib) => Number(c.amount_paid ?? c.amount);

/** Shared contributions dashboard. The table + donut are contribution-level (a
 *  ledger), so every refund stays visible and the numbers reconcile. */
export default function ContributionOverview({
  towers, flats, contribs,
}: { towers: OverviewTower[]; flats: OverviewFlat[]; contribs: OverviewContrib[] }) {
  // contribution-level counts (each contribution is one slice)
  const counts = { verified: 0, awaiting: 0, pending: 0, refunded: 0 };
  const flatsWithActivity = new Set<string>();
  const flatsPaid = new Set<string>();
  for (const c of contribs) {
    const st = effState(c);
    if (st === 'none') continue;
    flatsWithActivity.add(c.flat_id);
    if (st === 'verified') { counts.verified += 1; flatsPaid.add(c.flat_id); }
    else if (st === 'awaiting') counts.awaiting += 1;
    else if (st === 'pending') counts.pending += 1;
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
          <div className="stat-label">Collected (verified)</div>
        </div>
        <div className="stat blue">
          <div className="stat-value">{counts.awaiting}</div>
          <div className="stat-label">Awaiting verification</div>
        </div>
        <div className="stat amber">
          <div className="stat-value">{flatsPaid.size}/{flats.length}</div>
          <div className="stat-label">Flats paid</div>
        </div>
        {(refundedTotal > 0 || counts.refunded > 0) && (
          <div className="stat red">
            <div className="stat-value">{formatINR(refundedTotal)}</div>
            <div className="stat-label">Refunded ({counts.refunded})</div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Contribution status</h3>
        <Donut
          segments={[
            { value: counts.verified, color: '#15803d', label: 'Verified' },
            { value: counts.awaiting, color: '#1d4ed8', label: 'Awaiting' },
            { value: counts.pending, color: '#b45309', label: 'Started' },
            { value: counts.refunded, color: '#b91c1c', label: 'Refunded' },
            { value: notStarted, color: '#e7d8bf', label: 'Not started' },
          ]}
          centerLabel={flats.length ? `${pctPaid}%` : '—'}
          centerSub="paid"
        />
      </div>

      <div className="card">
        <h3>Amount collected by tower</h3>
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

      <LedgerTable towers={towers} flats={flats} contribs={contribs} collectedByTower={collectedByTower} />
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
  const multiTower = towers.length > 1;
  const towerName = (id: string) => towers.find((t) => t.id === id)?.name ?? '—';
  const flatInfo = new Map(flats.map((f) => [f.id, f]));

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

  const collectedTotal = towerFilter === 'all'
    ? [...collectedByTower.values()].reduce((s, v) => s + v, 0)
    : collectedByTower.get(towerFilter) ?? 0;

  return (
    <div className="card">
      <div className="between">
        <h3>Flats &amp; amounts</h3>
        <button className="secondary" disabled={rows.length === 0} onClick={exportCsv}>Download CSV</button>
      </div>
      <div className="row" style={{ marginBottom: '0.6rem' }}>
        {multiTower && (
          <select value={towerFilter} onChange={(e) => setTowerFilter(e.target.value)} style={{ flex: 1 }}>
            <option value="all">All towers</option>
            {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | RowState)} style={{ flex: 1 }}>
          <option value="all">All statuses</option>
          <option value="verified">Verified</option>
          <option value="awaiting">Awaiting</option>
          <option value="pending">Started</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="muted">
          {towerFilter !== 'all' || statusFilter !== 'all' ? 'No contributions match these filters.' : 'No contributions yet.'}
        </p>
      ) : (
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
            {rows.map((r) => (
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
              <th>Total collected</th>
              {multiTower && <th />}
              <th />
              <th>{formatINR(collectedTotal)}</th>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
