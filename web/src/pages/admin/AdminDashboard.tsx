import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import OfflinePaymentForm from '../../components/OfflinePaymentForm';
import ContributionOverview, {
  type OverviewContrib, type OverviewFlat, type OverviewTower,
} from '../../components/ContributionOverview';
import { byName } from '../../lib/ui';
import type { EventConfig } from '../../lib/types';

export default function AdminDashboard() {
  const [event, setEvent] = useState<EventConfig | null>(null);
  const [towers, setTowers] = useState<OverviewTower[]>([]);
  const [flats, setFlats] = useState<OverviewFlat[]>([]);
  const [contribs, setContribs] = useState<OverviewContrib[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: ev } = await supabase.from('events').select('*').eq('is_active', true).maybeSingle();
    const event = (ev as EventConfig | null) ?? null;
    setEvent(event);

    const [{ data: tw }, { data: fl }] = await Promise.all([
      supabase.from('towers').select('id, name').order('name'),
      supabase.from('flats').select('id, tower_id, flat_number').order('flat_number'),
    ]);
    setTowers(((tw as OverviewTower[]) ?? []).sort(byName));
    setFlats((fl as OverviewFlat[]) ?? []);

    if (event) {
      const { data: c, error: e } = await supabase
        .from('contributions')
        .select('flat_id, paid_to_tower_id, status, amount, amount_paid')
        .eq('event_id', event.id);
      if (e) setError(e.message);
      setContribs((c as OverviewContrib[]) ?? []);
    } else {
      setContribs([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <p className="page-back"><Link to="/admin">← Admin</Link></p>
      <div className="between">
        <h2>Dashboard</h2>
        <button className="secondary" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : !event ? (
        <div className="card"><p className="muted">No active event. Activate one under Events &amp; config.</p></div>
      ) : (
        <>
          <p className="muted">{event.name} · contributions</p>

          <div className="card card-accent">
            <h3>Record a walk-in / offline payment</h3>
            <p className="muted">For a resident who paid a rep directly without using the app — marks the flat as paid.</p>
            <OfflinePaymentForm towers={towers} onRecorded={load} />
          </div>

          <ContributionOverview towers={towers} flats={flats} contribs={contribs} />
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
