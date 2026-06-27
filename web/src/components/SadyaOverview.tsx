import { useState } from 'react';
import { formatINR } from '../lib/format';
import { downloadCsv } from '../lib/ui';
import { Donut } from './Charts';
import Modal from './Modal';
import type { OverviewTower } from './ContributionOverview';
import type { SadyaStatus } from '../lib/types';

const ROWS_PREVIEW = 15;

export interface OverviewSadya {
  id: string;
  paid_to_tower_id: string;
  flat_number: string | null;
  resident_name: string | null;
  status: SadyaStatus;
  num_adults: number;
  num_children: number;
  total_persons: number;
  total_amount: number;
  amount_paid: number | null;
}

/** A ticket-cancellation request (separate from a booking). 'refunded' = money
 *  paid back; 'requested' = pending. Both have already left the flat's QR. */
export interface OverviewCancellation {
  id: string;
  paid_to_tower_id: string;
  flat_number: string | null;
  resident_name: string | null;
  num_adults: number;
  num_children: number;
  total_persons: number;
  amount: number;
  status: 'requested' | 'refunded';
}

type RowState = 'verified' | 'awaiting' | 'refunded' | 'requested';
const STATE_LABEL: Record<RowState, string> = {
  verified: 'Verified', awaiting: 'Awaiting Approval', refunded: 'Refunded', requested: 'Refund Requested',
};
// Refund rows reuse soft-badge palette (no dedicated 'requested' class → 'pending').
const STATE_BADGE: Record<RowState, string> = {
  verified: 'verified', awaiting: 'awaiting', refunded: 'refunded', requested: 'pending',
};

/** Bookings surface two payment states; refunds live in their own ledger.
 *  A started/rejected/expired/cancelled booking counts as no payment (null). */
function rowState(s: OverviewSadya): 'verified' | 'awaiting' | null {
  switch (s.status) {
    case 'verified': return 'verified';
    case 'submitted': return 'awaiting';
    default: return null; // payment_pending / rejected / cancelled / expired
  }
}
const sAmt = (s: OverviewSadya) => Number(s.amount_paid ?? s.total_amount);

/** Sadya bookings dashboard — mirrors ContributionOverview but booking-level
 *  (many per flat) with person counts. Verified bookings are the collected money;
 *  ticket cancellations net off both the money and the meals. */
export default function SadyaOverview({
  towers, sadya, cancellations = [],
}: { towers: OverviewTower[]; sadya: OverviewSadya[]; cancellations?: OverviewCancellation[] }) {
  const counts = { verified: 0, awaiting: 0 };
  let grossTotal = 0;
  let grossMeals = 0;       // passes across verified bookings (before cancellations)
  let awaitingPasses = 0;   // passes in bookings still awaiting verification
  const collectedByTower = new Map<string, number>();
  for (const s of sadya) {
    const st = rowState(s);
    if (!st) continue;
    counts[st] += 1;
    if (st === 'verified') {
      grossTotal += sAmt(s);
      grossMeals += s.total_persons;
      collectedByTower.set(s.paid_to_tower_id, (collectedByTower.get(s.paid_to_tower_id) ?? 0) + sAmt(s));
    } else if (st === 'awaiting') {
      awaitingPasses += s.total_persons;
    }
  }

  // Cancellations net off collections (only once refunded) and meals (always).
  let refundedTotal = 0;     // ₹ actually paid back
  let cancelledPasses = 0;   // passes removed from QRs (requested + refunded)
  for (const c of cancellations) {
    cancelledPasses += c.total_persons;
    if (c.status === 'refunded') {
      refundedTotal += c.amount;
      collectedByTower.set(c.paid_to_tower_id, (collectedByTower.get(c.paid_to_tower_id) ?? 0) - c.amount);
    }
  }
  const verifiedTotal = grossTotal - refundedTotal;
  const mealsConfirmed = Math.max(0, grossMeals - cancelledPasses);
  const maxTower = Math.max(1, ...towers.map((t) => collectedByTower.get(t.id) ?? 0));

  return (
    <>
      <div className="grid cols-3">
        <div className="stat green">
          <div className="stat-value">{formatINR(verifiedTotal)}</div>
          <div className="stat-label">Collected (Verified)</div>
        </div>
        <div className="stat blue">
          <div className="stat-value">{counts.awaiting}</div>
          <div className="stat-label">{counts.awaiting === 1 ? 'Request' : 'Requests'} Awaiting Verification</div>
        </div>
        <div className="stat amber">
          <div className="stat-value">{mealsConfirmed}</div>
          <div className="stat-label">Meals Confirmed</div>
        </div>
        {(refundedTotal > 0 || cancelledPasses > 0) && (
          <div className="stat red">
            <div className="stat-value">{formatINR(refundedTotal)}</div>
            <div className="stat-label">Refunded ({cancelledPasses} {cancelledPasses === 1 ? 'pass' : 'passes'} cancelled)</div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Sadya Booking Status</h3>
        <Donut
          segments={[
            { value: mealsConfirmed, color: '#15803d', label: 'Verified' },
            { value: awaitingPasses, color: '#1d4ed8', label: 'Awaiting Approval' },
            { value: cancelledPasses, color: '#b91c1c', label: 'Refunded' },
          ]}
          centerLabel={String(mealsConfirmed + awaitingPasses + cancelledPasses)}
          centerSub="Passes"
        />
      </div>

      <SadyaLedgerTable towers={towers} sadya={sadya} cancellations={cancellations} collectedByTower={collectedByTower} />

      <div className="card">
        <h3>Sadya Collected by Tower</h3>
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

function SadyaLedgerTable({
  towers, sadya, cancellations, collectedByTower,
}: {
  towers: OverviewTower[];
  sadya: OverviewSadya[];
  cancellations: OverviewCancellation[];
  collectedByTower: Map<string, number>;
}) {
  const [towerFilter, setTowerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | RowState>('all');
  const [expanded, setExpanded] = useState(false);
  const multiTower = towers.length > 1;
  const towerName = (id: string) => towers.find((t) => t.id === id)?.name ?? '—';

  type Row = { id: string; flat: string; resident: string; towerId: string; adults: number; children: number; persons: number; st: RowState; amt: number };
  const bookingRows: Row[] = sadya.flatMap((s) => {
    const st = rowState(s);
    if (!st) return [];
    return [{
      id: s.id,
      flat: s.flat_number ?? '—',
      resident: s.resident_name ?? '—',
      towerId: s.paid_to_tower_id,
      adults: s.num_adults,
      children: s.num_children,
      persons: s.total_persons,
      st,
      amt: sAmt(s),
    }];
  });
  // Cancellations show as their own ledger rows (Refunded / Refund Requested).
  const cancelRows: Row[] = cancellations.map((c) => ({
    id: `c-${c.id}`,
    flat: c.flat_number ?? '—',
    resident: c.resident_name ?? '—',
    towerId: c.paid_to_tower_id,
    adults: c.num_adults,
    children: c.num_children,
    persons: c.total_persons,
    st: c.status,
    amt: c.amount,
  }));
  const rows = [...bookingRows, ...cancelRows]
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
      `onam-sadya-${stamp}.csv`,
      ['Tower', 'Flat', 'Resident', 'Adults', 'Children', 'Persons', 'Status', 'Amount (Rs.)'],
      rows.map((r) => [towerName(r.towerId), r.flat, r.resident, r.adults, r.children, r.persons, STATE_LABEL[r.st], r.amt]),
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
        <option value="requested">Refund Requested</option>
        <option value="refunded">Refunded</option>
      </select>
    </div>
  );

  const renderTable = (visible: typeof rows) => (
    <table className="tbl">
      <thead>
        <tr>
          <th>Flat</th>
          {multiTower && <th>Tower</th>}
          <th>Resident</th>
          <th>Persons</th>
          <th>Status</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        {visible.map((r) => (
          <tr key={r.id}>
            <td>{r.flat}</td>
            {multiTower && <td>{towerName(r.towerId)}</td>}
            <td>{r.resident}</td>
            <td>{r.persons}</td>
            <td><span className={`badge soft ${STATE_BADGE[r.st]}`}>{STATE_LABEL[r.st]}</span></td>
            <td>{r.amt ? formatINR(r.amt) : '—'}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th>Total Collected</th>
          {multiTower && <th />}
          <th />
          <th />
          <th>{formatINR(collectedTotal)}</th>
        </tr>
      </tfoot>
    </table>
  );

  const emptyMsg = (
    <p className="muted">
      {towerFilter !== 'all' || statusFilter !== 'all' ? 'No bookings match these filters.' : 'No sadya bookings yet.'}
    </p>
  );
  const hasOverflow = rows.length > ROWS_PREVIEW;

  return (
    <div className="card">
      <div className="between">
        <h3>Bookings &amp; Amounts</h3>
        <button className="secondary" disabled={rows.length === 0} onClick={exportCsv}>Download CSV</button>
      </div>
      {filters}
      {rows.length === 0 ? emptyMsg : renderTable(rows.slice(0, ROWS_PREVIEW))}
      {hasOverflow && (
        <button type="button" className="secondary" style={{ width: '100%' }} onClick={() => setExpanded(true)}>
          Show All {rows.length} →
        </button>
      )}

      {expanded && (
        <Modal title="Sadya Bookings & Amounts" onClose={() => setExpanded(false)} wide>
          <div className="between" style={{ marginBottom: '0.4rem' }}>
            <span className="muted">{rows.length} booking{rows.length === 1 ? '' : 's'}</span>
            <button className="secondary" disabled={rows.length === 0} onClick={exportCsv}>Download CSV</button>
          </div>
          {filters}
          {rows.length === 0 ? emptyMsg : renderTable(rows)}
        </Modal>
      )}
    </div>
  );
}
