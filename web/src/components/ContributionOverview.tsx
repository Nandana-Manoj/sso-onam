import { useState } from 'react';
import { formatINR } from '../lib/format';
import { Donut } from './Charts';
import type { ContributionStatus } from '../lib/types';

export interface OverviewTower { id: string; name: string }
export interface OverviewFlat { id: string; tower_id: string; flat_number: string }
export interface OverviewContrib {
  flat_id: string;
  paid_to_tower_id: string;
  status: ContributionStatus;
  amount: number;
  amount_paid: number | null;
}

type FlatState = 'verified' | 'awaiting' | 'pending' | 'none';
const PRIORITY: Record<ContributionStatus, number> = {
  verified: 4, submitted: 3, payment_pending: 2, rejected: 1, expired: 0,
};
const STATE_LABEL: Record<FlatState, string> = {
  verified: 'Verified', awaiting: 'Awaiting', pending: 'Started', none: 'Not started',
};

/** Shared contributions dashboard: stat tiles + status donut + per-tower bars
 *  that expand to each flat's status and paid amount. Used by admin and reps. */
export default function ContributionOverview({
  towers, flats, contribs,
}: { towers: OverviewTower[]; flats: OverviewFlat[]; contribs: OverviewContrib[] }) {
  const [open, setOpen] = useState<string | null>(null);

  const amt = (c: OverviewContrib) => Number(c.amount_paid ?? c.amount);

  // best (current) status + amount per flat
  const best = new Map<string, { status: ContributionStatus; amount: number }>();
  for (const c of contribs) {
    const cur = best.get(c.flat_id);
    if (!cur || PRIORITY[c.status] > PRIORITY[cur.status]) best.set(c.flat_id, { status: c.status, amount: amt(c) });
  }
  const stateOf = (flatId: string): FlatState => {
    const s = best.get(flatId)?.status;
    return s === 'verified' ? 'verified' : s === 'submitted' ? 'awaiting' : s === 'payment_pending' ? 'pending' : 'none';
  };

  const verifiedTotal = contribs.filter((c) => c.status === 'verified').reduce((s, c) => s + amt(c), 0);
  const counts = { verified: 0, awaiting: 0, pending: 0, none: 0 };
  for (const f of flats) counts[stateOf(f.id)] += 1;

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
          <div className="stat-value">{counts.verified}/{flats.length}</div>
          <div className="stat-label">Flats paid</div>
        </div>
      </div>

      <div className="card">
        <h3>Contribution status</h3>
        <Donut
          segments={[
            { value: counts.verified, color: '#15803d', label: 'Verified' },
            { value: counts.awaiting, color: '#1d4ed8', label: 'Awaiting' },
            { value: counts.pending, color: '#b45309', label: 'Started' },
            { value: counts.none, color: '#e7d8bf', label: 'Not started' },
          ]}
          centerLabel={flats.length ? `${Math.round((counts.verified / flats.length) * 100)}%` : '—'}
          centerSub="paid"
        />
      </div>

      <div className="card">
        <h3>By tower · flats verified</h3>
        {towers.map((t) => {
          const tFlats = flats.filter((f) => f.tower_id === t.id);
          const v = tFlats.filter((f) => stateOf(f.id) === 'verified').length;
          const pct = tFlats.length ? (v / tFlats.length) * 100 : 0;
          const isOpen = open === t.id;
          return (
            <div key={t.id}>
              <div
                className="bar-row"
                style={{ cursor: tFlats.length ? 'pointer' : 'default' }}
                onClick={() => tFlats.length && setOpen(isOpen ? null : t.id)}
              >
                <span className="bar-name">{isOpen ? '▾ ' : '▸ '}{t.name}</span>
                <span className="bar-track"><span className="bar-fill" style={{ width: `${pct}%` }} /></span>
                <span className="bar-val">{v}/{tFlats.length}</span>
              </div>
              {isOpen && (
                <div className="flat-grid" style={{ marginBottom: '0.7rem' }}>
                  {tFlats.length === 0 && <span className="muted">No flats registered yet.</span>}
                  {tFlats.map((f) => {
                    const st = stateOf(f.id);
                    const a = best.get(f.id)?.amount;
                    return (
                      <span key={f.id} className={`flat-pill ${st}`}>
                        <span className="dot" />
                        {f.flat_number}
                        <span className="muted" style={{ fontSize: '0.72rem' }}>
                          {st === 'verified' && a ? `· ${formatINR(a)}` : `· ${STATE_LABEL[st]}`}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {towers.length === 0 && <p className="muted">No towers yet.</p>}
      </div>

      <FlatTable towers={towers} flats={flats} stateOf={stateOf} amountOf={(id) => best.get(id)?.amount} />
    </>
  );
}

function FlatTable({
  towers, flats, stateOf, amountOf,
}: {
  towers: OverviewTower[];
  flats: OverviewFlat[];
  stateOf: (flatId: string) => FlatState;
  amountOf: (flatId: string) => number | undefined;
}) {
  const [towerFilter, setTowerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FlatState>('all');
  const multiTower = towers.length > 1;
  const towerName = (id: string) => towers.find((t) => t.id === id)?.name ?? '—';

  const rows = flats
    .filter((f) => stateOf(f.id) !== 'none')
    .filter((f) => towerFilter === 'all' || f.tower_id === towerFilter)
    .filter((f) => statusFilter === 'all' || stateOf(f.id) === statusFilter)
    .map((f) => ({ id: f.id, flat: f.flat_number, towerId: f.tower_id, st: stateOf(f.id), amt: amountOf(f.id) }))
    .sort((a, b) =>
      a.towerId === b.towerId
        ? a.flat.localeCompare(b.flat, undefined, { numeric: true })
        : towerName(a.towerId).localeCompare(towerName(b.towerId), undefined, { numeric: true }),
    );

  return (
    <div className="card">
      <h3>Flats &amp; amounts</h3>
      <div className="row" style={{ marginBottom: '0.6rem' }}>
        {multiTower && (
          <select value={towerFilter} onChange={(e) => setTowerFilter(e.target.value)} style={{ flex: 1 }}>
            <option value="all">All towers</option>
            {towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | FlatState)} style={{ flex: 1 }}>
          <option value="all">All statuses</option>
          <option value="verified">Verified</option>
          <option value="awaiting">Awaiting</option>
          <option value="pending">Started</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="muted">
          {towerFilter !== 'all' || statusFilter !== 'all' ? 'No flats match these filters.' : 'No contributions yet.'}
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
                <td>{(r.st === 'verified' || r.st === 'awaiting') && r.amt ? formatINR(r.amt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
