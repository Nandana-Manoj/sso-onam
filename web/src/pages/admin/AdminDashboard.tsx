import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import OfflinePaymentForm from '../../components/OfflinePaymentForm';
import RevenueDashboard from '../../components/RevenueDashboard';
import SadyaScanOverview from '../../components/SadyaScanOverview';
import {
  type OverviewContrib, type OverviewFlat, type OverviewTower,
} from '../../components/ContributionOverview';
import { type OverviewSadya, type OverviewCancellation } from '../../components/SadyaOverview';
import { byName } from '../../lib/ui';
import type { EventConfig, SadyaStatus } from '../../lib/types';

interface SadyaJoinRow {
  id: string;
  paid_to_tower_id: string;
  status: SadyaStatus;
  num_adults: number;
  num_children: number;
  total_persons: number;
  total_amount: number;
  amount_paid: number | null;
  flats: { flat_number: string } | null;
  resident: { name: string } | null;
}
interface CancelJoinRow {
  id: string;
  paid_to_tower_id: string;
  num_adults: number;
  num_children: number;
  total_persons: number;
  amount: number;
  status: 'requested' | 'refunded';
  flats: { flat_number: string } | null;
  resident: { name: string } | null;
}

/** Flatten the joined sadya_bookings rows into the OverviewSadya shape. */
export function mapSadya(data: unknown): OverviewSadya[] {
  return ((data as SadyaJoinRow[]) ?? []).map((r) => ({
    id: r.id,
    paid_to_tower_id: r.paid_to_tower_id,
    flat_number: r.flats?.flat_number ?? null,
    resident_name: r.resident?.name ?? null,
    status: r.status,
    num_adults: r.num_adults,
    num_children: r.num_children,
    total_persons: r.total_persons,
    total_amount: r.total_amount,
    amount_paid: r.amount_paid,
  }));
}

export default function AdminDashboard() {
  const [event, setEvent] = useState<EventConfig | null>(null);
  const [towers, setTowers] = useState<OverviewTower[]>([]);
  const [flats, setFlats] = useState<OverviewFlat[]>([]);
  const [contribs, setContribs] = useState<OverviewContrib[]>([]);
  const [sadya, setSadya] = useState<OverviewSadya[]>([]);
  const [cancellations, setCancellations] = useState<OverviewCancellation[]>([]);
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
      const [{ data: c, error: e }, { data: sb, error: se }, { data: sc }] = await Promise.all([
        supabase
          .from('contributions')
          .select('id, flat_id, paid_to_tower_id, status, amount, amount_paid, refund_state')
          .eq('event_id', event.id),
        supabase
          .from('sadya_bookings')
          .select('id, paid_to_tower_id, status, num_adults, num_children, total_persons, total_amount, amount_paid, flats(flat_number), resident:profiles!resident_id(name)')
          .eq('event_id', event.id),
        supabase
          .from('sadya_cancellations')
          .select('id, paid_to_tower_id, num_adults, num_children, total_persons, amount, status, flats(flat_number), resident:profiles!resident_id(name)')
          .eq('event_id', event.id),
      ]);
      if (e) setError(e.message);
      else if (se) setError(se.message);
      setContribs((c as OverviewContrib[]) ?? []);
      setSadya(mapSadya(sb));
      setCancellations(((sc as unknown as CancelJoinRow[]) ?? []).map((r) => ({
        id: r.id, paid_to_tower_id: r.paid_to_tower_id,
        flat_number: r.flats?.flat_number ?? null, resident_name: r.resident?.name ?? null,
        num_adults: r.num_adults, num_children: r.num_children,
        total_persons: r.total_persons, amount: r.amount, status: r.status,
      })));
    } else {
      setContribs([]);
      setSadya([]);
      setCancellations([]);
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
          <p className="muted">{event.name} · revenue</p>

          <RevenueDashboard towers={towers} flats={flats} contribs={contribs} sadya={sadya} cancellations={cancellations} />

          <SadyaScanOverview eventId={event.id} servingOpen={event.sadya_serving_open} />

          <details className="disclosure card card-accent">
            <summary>Record a Walk-In / Offline Payment</summary>
            <p className="muted">For a resident who paid a rep directly without using the app — marks the flat as paid.</p>
            <OfflinePaymentForm
              towers={towers}
              sadyaPrices={event.sadya_open ? { adult: event.adult_sadya_price, child: event.child_sadya_price } : undefined}
              sadyaClosedNote={event.sadya_open ? undefined : "Sadya walk-ins aren't available until booking opens."}
              onRecorded={load}
            />
          </details>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
