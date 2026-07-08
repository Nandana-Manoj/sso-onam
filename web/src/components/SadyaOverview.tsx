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
          <div className="stat-label">{mealsConfirmed === 1 ? 'Meal' : 'Meals'} Confirmed</div>
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
          centerSub="No. of Leaves"
        />
      </div>

      <SadyaLedgerTable towers={towers} sadya={sadya} cancellations={cancellations} />

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

// One aggregated row per flat (kept narrow so it fits a phone screen).
interface FlatRow {
  key: string;
  flat: string;
  towerId: string;
  bookings: number;        // count of bookings (verified + awaiting)
  confirmedPasses: number; // verified persons − cancelled (matches the flat's QR)
  awaitingPasses: number;  // persons in bookings still awaiting verification
  collected: number;       // verified collected − refunded
  refunded: number;        // ₹ paid back
}

function SadyaLedgerTable({
  towers, sadya, cancellations,
}: {
  towers: OverviewTower[];
  sadya: OverviewSadya[];
  cancellations: OverviewCancellation[];
}) {
  const [towerFilter, setTowerFilter] = useState('all');
  const [expanded, setExpanded] = useState(false);
  const multiTower = towers.length > 1;
  const towerName = (id: string) => towers.find((t) => t.id === id)?.name ?? '—';

  // Aggregate everything down to one row per flat.
  const byFlat = new Map<string, FlatRow>();
  const get = (towerId: string, flat: string) => {
    const key = `${towerId}|${flat}`;
    let r = byFlat.get(key);
    if (!r) {
      r = { key, flat, towerId, bookings: 0, confirmedPasses: 0, awaitingPasses: 0, collected: 0, refunded: 0 };
      byFlat.set(key, r);
    }
    return r;
  };
  for (const s of sadya) {
    const st = rowState(s);
    if (!st) continue;
    const r = get(s.paid_to_tower_id, s.flat_number ?? '—');
    r.bookings += 1;
    if (st === 'verified') { r.confirmedPasses += s.total_persons; r.collected += sAmt(s); }
    else r.awaitingPasses += s.total_persons;
  }
  for (const c of cancellations) {
    const r = get(c.paid_to_tower_id, c.flat_number ?? '—');
    r.confirmedPasses = Math.max(0, r.confirmedPasses - c.total_persons);
    if (c.status === 'refunded') { r.refunded += c.amount; r.collected -= c.amount; }
  }

  const rows = [...byFlat.values()]
    .filter((r) => towerFilter === 'all' || r.towerId === towerFilter)
    .sort((a, b) =>
      a.towerId === b.towerId
        ? a.flat.localeCompare(b.flat, undefined, { numeric: true })
        : towerName(a.towerId).localeCompare(towerName(b.towerId), undefined, { numeric: true }),
    );
  const collectedTotal = rows.reduce((s, r) => s + r.collected, 0);

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `onam-sadya-${stamp}.csv`,
      ['Tower', 'Flat', 'Bookings', 'Confirmed No. of Leaves', 'Awaiting No. of Leaves', 'Collected (Rs.)', 'Refunded (Rs.)'],
      rows.map((r) => [towerName(r.towerId), r.flat, r.bookings, r.confirmedPasses, r.awaitingPasses, r.collected, r.refunded]),
    );
  }

  const filters = multiTower ? (
    <div className="row" style={{ marginBottom: '0.6rem' }}>
      <select value={towerFilter} onChange={(e) => setTowerFilter(e.target.value)} style={{ flex: 1 }}>
        <option value="all">All Towers</option>
        {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  ) : null;

  const renderTable = (visible: FlatRow[]) => (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Flat</th>
            {multiTower && <th>Tower</th>}
            <th>Bookings</th>
            <th>No. of Leaves</th>
            <th>Collected</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.key}>
              <td>{r.flat}</td>
              {multiTower && <td>{towerName(r.towerId)}</td>}
              <td>{r.bookings}</td>
              <td>{r.confirmedPasses}{r.awaitingPasses ? ` (+${r.awaitingPasses})` : ''}</td>
              <td>{r.collected ? formatINR(r.collected) : '—'}</td>
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
    </div>
  );

  const emptyMsg = (
    <p className="muted">{towerFilter !== 'all' ? 'No bookings for this tower.' : 'No sadya bookings yet.'}</p>
  );
  const hasOverflow = rows.length > ROWS_PREVIEW;

  return (
    <div className="card">
      <div className="between">
        <h3>Bookings by Flat</h3>
        <button className="secondary" disabled={rows.length === 0} onClick={exportCsv}>Download CSV</button>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
        No. of Leaves = confirmed meals on the flat's QR; a <code>(+n)</code> shows leaves still awaiting verification.
      </p>
      {filters}
      {rows.length === 0 ? emptyMsg : renderTable(rows.slice(0, ROWS_PREVIEW))}
      {hasOverflow && (
        <button type="button" className="secondary" style={{ width: '100%' }} onClick={() => setExpanded(true)}>
          Show All {rows.length} {rows.length === 1 ? 'Flat' : 'Flats'} →
        </button>
      )}

      {expanded && (
        <Modal title="Sadya — Bookings by Flat" onClose={() => setExpanded(false)} wide>
          <div className="between" style={{ marginBottom: '0.4rem' }}>
            <span className="muted">{rows.length} flat{rows.length === 1 ? '' : 's'}</span>
            <button className="secondary" disabled={rows.length === 0} onClick={exportCsv}>Download CSV</button>
          </div>
          {filters}
          {rows.length === 0 ? emptyMsg : renderTable(rows)}
        </Modal>
      )}
    </div>
  );
}
