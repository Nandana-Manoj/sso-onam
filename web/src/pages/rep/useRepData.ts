import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { byName } from '../../lib/ui';
import { type OverviewFlat, type OverviewTower } from '../../components/ContributionOverview';
import type { ContributionStatus, SadyaStatus } from '../../lib/types';

export interface ManagedTower extends OverviewTower {
  rep_contact: string | null;
  rep_upi_id: string | null;
  rep_payment_phone: string | null;
  payment_qr_path: string | null;
}
export interface ContribRow {
  id: string;
  flat_id: string;
  paid_to_tower_id: string;
  status: ContributionStatus;
  amount: number;
  amount_paid: number | null;
  utr: string | null;
  payment_submitted_at: string | null;
  refund_state: 'requested' | 'refunded' | null;
  refund_reason: string | null;
  flats: { flat_number: string } | null;
  resident: { name: string } | null;
}
export interface SadyaRow {
  id: string;
  paid_to_tower_id: string;
  status: SadyaStatus;
  num_adults: number;
  num_children: number;
  total_persons: number;
  total_amount: number;
  amount_paid: number | null;
  utr: string | null;
  payment_submitted_at: string | null;
  flats: { flat_number: string } | null;
  resident: { name: string } | null;
}
export interface SadyaCancelRow {
  id: string;
  paid_to_tower_id: string;
  num_adults: number;
  num_children: number;
  total_persons: number;
  amount: number;
  status: 'requested' | 'refunded';
  reason: string | null;
  flats: { flat_number: string } | null;
  resident: { name: string } | null;
}
export interface SettlementRow {
  id: string;
  tower_id: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface RepData {
  loading: boolean;
  error: string | null;
  towers: ManagedTower[];
  flats: OverviewFlat[];
  contribs: ContribRow[];
  sadya: SadyaRow[];
  sadyaCancels: SadyaCancelRow[];
  settlements: SettlementRow[];
  sadyaPrices: { adult: number; child: number } | undefined;
  eventId: string | null;
  servingOpen: boolean;
  reload: () => Promise<void>;
}

/** Shared data layer for the rep tools. Each rep sub-page loads the same slice
 *  of state (the rep's towers + their contributions/sadya/settlements for the
 *  active event) so the hub and its pages stay consistent. */
export function useRepData(): RepData {
  const { profile } = useAuth();
  const [towers, setTowers] = useState<ManagedTower[]>([]);
  const [flats, setFlats] = useState<OverviewFlat[]>([]);
  const [contribs, setContribs] = useState<ContribRow[]>([]);
  const [sadya, setSadya] = useState<SadyaRow[]>([]);
  const [sadyaCancels, setSadyaCancels] = useState<SadyaCancelRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [sadyaPrices, setSadyaPrices] = useState<{ adult: number; child: number } | undefined>(undefined);
  const [eventId, setEventId] = useState<string | null>(null);
  const [servingOpen, setServingOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return; }

    const [{ data: tw }, { data: ev }] = await Promise.all([
      supabase
        .from('towers')
        .select('id, name, rep_contact, rep_upi_id, rep_payment_phone, payment_qr_path')
        .eq('rep_user_id', profile.id),
      supabase.from('events')
        .select('id, adult_sadya_price, child_sadya_price, sadya_serving_open')
        .eq('is_active', true).maybeSingle(),
    ]);

    const managed = ((tw as ManagedTower[]) ?? []).sort(byName);
    setTowers(managed);

    const evp = ev as {
      id: string; adult_sadya_price: number; child_sadya_price: number; sadya_serving_open: boolean;
    } | null;
    setSadyaPrices(evp ? { adult: evp.adult_sadya_price, child: evp.child_sadya_price } : undefined);
    setEventId(evp?.id ?? null);
    setServingOpen(!!evp?.sadya_serving_open);

    const ids = managed.map((t) => t.id);
    if (ids.length === 0) {
      setFlats([]); setContribs([]); setSadya([]); setSadyaCancels([]); setSettlements([]); setLoading(false); return;
    }

    const [{ data: fl }, { data: c, error: e }, { data: sb }, { data: sc }, { data: sett }] = await Promise.all([
      supabase.from('flats').select('id, tower_id, flat_number').in('tower_id', ids).order('flat_number'),
      supabase
        .from('contributions')
        .select('id, flat_id, paid_to_tower_id, status, amount, amount_paid, utr, payment_submitted_at, refund_state, refund_reason, flats(flat_number), resident:profiles!initiated_by_user_id(name)')
        .in('paid_to_tower_id', ids)
        .order('payment_submitted_at', { ascending: true }),
      supabase
        .from('sadya_bookings')
        .select('id, paid_to_tower_id, status, num_adults, num_children, total_persons, total_amount, amount_paid, utr, payment_submitted_at, flats(flat_number), resident:profiles!resident_id(name)')
        .in('paid_to_tower_id', ids)
        .order('payment_submitted_at', { ascending: true }),
      supabase
        .from('sadya_cancellations')
        .select('id, paid_to_tower_id, num_adults, num_children, total_persons, amount, status, reason, flats(flat_number), resident:profiles!resident_id(name)')
        .in('paid_to_tower_id', ids)
        .order('requested_at', { ascending: true }),
      evp
        ? supabase
            .from('rep_settlements')
            .select('id, tower_id, amount, note, created_at')
            .in('tower_id', ids)
            .eq('event_id', evp.id)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (e) setError(e.message);
    setFlats((fl as OverviewFlat[]) ?? []);
    setContribs((c as unknown as ContribRow[]) ?? []);
    setSadya((sb as unknown as SadyaRow[]) ?? []);
    setSadyaCancels((sc as unknown as SadyaCancelRow[]) ?? []);
    setSettlements((sett as unknown as SettlementRow[]) ?? []);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { reload(); }, [reload]);

  return {
    loading, error, towers, flats, contribs, sadya, sadyaCancels, settlements,
    sadyaPrices, eventId, servingOpen, reload,
  };
}

/** Total pending items awaiting the rep across all queues — drives the hub badge. */
export function pendingCounts(d: RepData) {
  const contribQueue = d.contribs.filter((c) => c.status === 'submitted').length;
  const refundQueue = d.contribs.filter((c) => c.refund_state === 'requested').length;
  const sadyaQueue = d.sadya.filter((s) => s.status === 'submitted').length;
  const sadyaCancelQueue = d.sadyaCancels.filter((s) => s.status === 'requested').length;
  return {
    contribQueue, refundQueue, sadyaQueue, sadyaCancelQueue,
    total: contribQueue + refundQueue + sadyaQueue + sadyaCancelQueue,
  };
}
