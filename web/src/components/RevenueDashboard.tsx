import { useState } from 'react';
import { formatINR } from '../lib/format';
import { downloadCsv } from '../lib/ui';
import { Donut } from './Charts';
import ContributionOverview, {
  type OverviewContrib, type OverviewFlat, type OverviewTower,
} from './ContributionOverview';
import SadyaOverview, { type OverviewSadya, type OverviewCancellation } from './SadyaOverview';

type Mode = 'combined' | 'contributions' | 'sadya';

const contribCollected = (c: OverviewContrib) =>
  c.status === 'verified' && c.refund_state !== 'refunded' ? Number(c.amount_paid ?? c.amount) : 0;
const sadyaCollected = (s: OverviewSadya) =>
  s.status === 'verified' ? Number(s.amount_paid ?? s.total_amount) : 0;
const sadyaRefunded = (c: OverviewCancellation) => (c.status === 'refunded' ? c.amount : 0);

/** Short rupee label that fits inside the donut centre (e.g. ₹2.4L, ₹45k). */
const compactINR = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(1)}L`
  : n >= 1000 ? `₹${Math.round(n / 1000)}k`
  : formatINR(n);

/** Revenue dashboard with a Combined / Contributions / Sadya switch. Reuses the
 *  existing contribution + sadya overviews; the combined view sums both streams. */
export default function RevenueDashboard({
  towers, flats, contribs, sadya, cancellations = [], showPerTowerBreakdown = true,
}: {
  towers: OverviewTower[];
  flats: OverviewFlat[];
  contribs: OverviewContrib[];
  sadya: OverviewSadya[];
  cancellations?: OverviewCancellation[];
  /** Hide the combined Per-Tower Breakdown table (reps see the leaderboard instead). */
  showPerTowerBreakdown?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('combined');

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      className={mode === m ? '' : 'secondary'}
      style={{ flex: 1 }}
      onClick={() => setMode(m)}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="row" style={{ gap: '0.4rem', marginBottom: '0.4rem' }}>
        {tab('combined', 'Combined')}
        {tab('contributions', 'Contributions')}
        {tab('sadya', 'Sadya')}
      </div>

      {mode === 'contributions' && <ContributionOverview towers={towers} flats={flats} contribs={contribs} />}
      {mode === 'sadya' && <SadyaOverview towers={towers} sadya={sadya} cancellations={cancellations} />}
      {mode === 'combined' && <CombinedOverview towers={towers} contribs={contribs} sadya={sadya} cancellations={cancellations} showPerTowerBreakdown={showPerTowerBreakdown} />}
    </>
  );
}

function CombinedOverview({
  towers, contribs, sadya, cancellations, showPerTowerBreakdown,
}: { towers: OverviewTower[]; contribs: OverviewContrib[]; sadya: OverviewSadya[]; cancellations: OverviewCancellation[]; showPerTowerBreakdown: boolean }) {
  const contribTotal = contribs.reduce((s, c) => s + contribCollected(c), 0);
  const sadyaTotal = sadya.reduce((s, b) => s + sadyaCollected(b), 0)
    - cancellations.reduce((s, c) => s + sadyaRefunded(c), 0);
  const grandTotal = contribTotal + sadyaTotal;

  const byTower = new Map<string, { contrib: number; sadya: number }>();
  const bump = (id: string, key: 'contrib' | 'sadya', amt: number) => {
    if (amt === 0) return;
    const cur = byTower.get(id) ?? { contrib: 0, sadya: 0 };
    cur[key] += amt;
    byTower.set(id, cur);
  };
  contribs.forEach((c) => bump(c.paid_to_tower_id, 'contrib', contribCollected(c)));
  sadya.forEach((b) => bump(b.paid_to_tower_id, 'sadya', sadyaCollected(b)));
  cancellations.forEach((c) => bump(c.paid_to_tower_id, 'sadya', -sadyaRefunded(c)));

  const towerTotal = (id: string) => {
    const t = byTower.get(id);
    return t ? t.contrib + t.sadya : 0;
  };

  // Families = distinct flat_ids with a verified, non-refunded contribution per tower.
  const familiesByTower = new Map<string, Set<string>>();
  contribs.forEach((c) => {
    if (c.status === 'verified' && c.refund_state !== 'refunded') {
      const s = familiesByTower.get(c.paid_to_tower_id) ?? new Set<string>();
      s.add(c.flat_id);
      familiesByTower.set(c.paid_to_tower_id, s);
    }
  });

  // Sadya passes = verified total_persons minus refunded cancellation total_persons per tower.
  const sadyaPassesByTower = new Map<string, number>();
  sadya.forEach((b) => {
    if (b.status === 'verified') {
      sadyaPassesByTower.set(b.paid_to_tower_id, (sadyaPassesByTower.get(b.paid_to_tower_id) ?? 0) + b.total_persons);
    }
  });
  cancellations.forEach((c) => {
    if (c.status === 'refunded') {
      sadyaPassesByTower.set(c.paid_to_tower_id, (sadyaPassesByTower.get(c.paid_to_tower_id) ?? 0) - c.total_persons);
    }
  });

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    const rows = towers.map((t) => [
      t.name,
      familiesByTower.get(t.id)?.size ?? 0,
      Math.max(0, sadyaPassesByTower.get(t.id) ?? 0),
      towerTotal(t.id),
    ]);
    rows.push(['Total', '', '', grandTotal]);
    downloadCsv(
      `onam-combined-${stamp}.csv`,
      ['Tower', 'Families Contributed', 'Sadya Passes Sold', 'Total (Rs.)'],
      rows,
    );
  }

  return (
    <>
      <div className="grid cols-3">
        <div className="stat green">
          <div className="stat-value">{formatINR(grandTotal)}</div>
          <div className="stat-label">Total Collected</div>
        </div>
        <div className="stat blue">
          <div className="stat-value">{formatINR(contribTotal)}</div>
          <div className="stat-label">Contributions</div>
        </div>
        <div className="stat amber">
          <div className="stat-value">{formatINR(sadyaTotal)}</div>
          <div className="stat-label">Sadya</div>
        </div>
      </div>

      <div className="card">
        <h3>Where the Money Came From</h3>
        <Donut
          segments={[
            { value: contribTotal, color: '#1d4ed8', label: 'Contributions' },
            { value: sadyaTotal, color: '#b45309', label: 'Sadya' },
          ]}
          centerLabel={grandTotal > 0 ? compactINR(grandTotal) : '—'}
          centerSub="Total"
        />
      </div>

      {showPerTowerBreakdown && (
        <div className="card">
          <div className="between">
            <h3>Per-Tower Breakdown</h3>
            <button className="secondary" disabled={towers.length === 0} onClick={exportCsv}>Download CSV</button>
          </div>
          <table className="tbl">
            <thead>
              <tr><th>Tower</th><th>Contributing Families</th><th>Sadya Passes</th><th>Total</th></tr>
            </thead>
            <tbody>
              {towers.map((t) => {
                const families = familiesByTower.get(t.id)?.size ?? 0;
                const passes = Math.max(0, sadyaPassesByTower.get(t.id) ?? 0);
                const total = towerTotal(t.id);
                return (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{families || '—'}</td>
                    <td>{passes || '—'}</td>
                    <td>{total ? formatINR(total) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <th />
                <th />
                <th>{formatINR(grandTotal)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
