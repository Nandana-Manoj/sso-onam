import { Link } from 'react-router-dom';
import RevenueDashboard from '../../components/RevenueDashboard';
import SadyaScanOverview from '../../components/SadyaScanOverview';
import TowerLeaderboard from '../../components/TowerLeaderboard';
import { type OverviewContrib } from '../../components/ContributionOverview';
import { type OverviewSadya, type OverviewCancellation } from '../../components/SadyaOverview';
import { useRepData } from './useRepData';

/** Read-only rep dashboards: money collected, sadya serving progress and the
 *  cross-tower leaderboard. */
export default function RepDashboard() {
  const { loading, towers, flats, contribs, sadya, sadyaCancels, eventId, servingOpen } = useRepData();

  const overviewContribs: OverviewContrib[] = contribs.map((c) => ({
    id: c.id, flat_id: c.flat_id, paid_to_tower_id: c.paid_to_tower_id,
    status: c.status, amount: c.amount, amount_paid: c.amount_paid, refund_state: c.refund_state,
  }));
  const overviewSadya: OverviewSadya[] = sadya.map((s) => ({
    id: s.id, paid_to_tower_id: s.paid_to_tower_id,
    flat_number: s.flats?.flat_number ?? null, resident_name: s.resident?.name ?? null,
    status: s.status, num_adults: s.num_adults, num_children: s.num_children,
    total_persons: s.total_persons, total_amount: s.total_amount, amount_paid: s.amount_paid,
  }));
  const overviewCancellations: OverviewCancellation[] = sadyaCancels.map((s) => ({
    id: s.id, paid_to_tower_id: s.paid_to_tower_id,
    flat_number: s.flats?.flat_number ?? null, resident_name: s.resident?.name ?? null,
    num_adults: s.num_adults, num_children: s.num_children,
    total_persons: s.total_persons, amount: s.amount, status: s.status,
  }));

  if (loading) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <p className="page-back"><Link to="/rep">← Rep Tools</Link></p>
      <h2>Dashboards</h2>

      <div className="section-title"><h3>Your Towers</h3></div>
      <RevenueDashboard
        towers={towers}
        flats={flats}
        contribs={overviewContribs}
        sadya={overviewSadya}
        cancellations={overviewCancellations}
        showPerTowerBreakdown={false}
      />

      {eventId && <SadyaScanOverview eventId={eventId} servingOpen={servingOpen} />}

      {eventId && (
        <>
          <div className="section-title"><h3>Tower Leaderboard</h3></div>
          <TowerLeaderboard eventId={eventId} />
        </>
      )}
    </div>
  );
}
