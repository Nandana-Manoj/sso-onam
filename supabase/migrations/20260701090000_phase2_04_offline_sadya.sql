-- Phase 2 · Migration 04 — Record an offline / walk-in SADYA booking.
-- Mirrors record_offline_contribution (phase1_08): a tower rep (own tower) or an
-- admin records a sadya booking for someone who paid directly. It lands as
-- 'verified' immediately and is added to the flat's single QR pass. Creates the
-- flat if needed. The booking is attributed to a resident of that flat when one
-- exists, otherwise to the recorder (so it still counts toward the flat's QR).

create or replace function public.record_offline_sadya(
  p_tower_id     uuid,
  p_flat_number  text,
  p_num_adults   int,
  p_num_children int,
  p_utr          text default null,
  p_note         text default null
) returns public.sadya_bookings
language plpgsql security definer set search_path = public as $$
declare
  v_uid         uuid := auth.uid();
  v_is_admin    boolean := public.is_admin();
  v_event       public.events;
  v_flat_number text := upper(nullif(btrim(p_flat_number), ''));
  v_flat_id     uuid;
  v_rep         uuid;
  v_resident    uuid;
  v_a           int := coalesce(p_num_adults, 0);
  v_c           int := coalesce(p_num_children, 0);
  v_total       numeric(10,2);
  v_booking     public.sadya_bookings;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_tower_id is null then raise exception 'Tower is required'; end if;
  if not (v_is_admin or (public.app_role() = 'tower_rep' and p_tower_id = public.app_tower_id())) then
    raise exception 'Not authorized to record bookings for this tower';
  end if;
  if v_flat_number is null then raise exception 'Flat number is required'; end if;
  if v_a < 0 or v_c < 0 then raise exception 'Counts cannot be negative'; end if;
  if v_a + v_c < 1 then raise exception 'Add at least one person'; end if;

  select * into v_event from public.events where is_active limit 1;
  if v_event is null then raise exception 'No active event'; end if;

  -- find or create the flat under this tower
  select id into v_flat_id from public.flats where tower_id = p_tower_id and flat_number = v_flat_number;
  if v_flat_id is null then
    insert into public.flats (tower_id, flat_number) values (p_tower_id, v_flat_number) returning id into v_flat_id;
  end if;

  select rep_user_id into v_rep from public.towers where id = p_tower_id;

  -- attribute to a resident of the flat if one exists, else the recorder
  select id into v_resident
    from public.profiles where flat_id = v_flat_id
    order by claimed desc, created_at asc limit 1;
  v_resident := coalesce(v_resident, v_uid);

  v_total := v_a * v_event.adult_sadya_price + v_c * v_event.child_sadya_price;

  insert into public.sadya_bookings (
    event_id, resident_id, flat_id, num_adults, num_children,
    adult_price_snapshot, child_price_snapshot, total_amount, status,
    paid_to_tower_id, paid_to_rep_user_id, amount_paid, utr,
    payment_submitted_at, verified_by_user_id, verified_at, decision_reason
  ) values (
    v_event.id, v_resident, v_flat_id, v_a, v_c,
    v_event.adult_sadya_price, v_event.child_sadya_price, v_total, 'verified',
    p_tower_id, coalesce(v_rep, v_uid), v_total, nullif(btrim(p_utr), ''),
    now(), v_uid, now(), nullif(btrim(p_note), '')
  ) returning * into v_booking;

  -- Add the tickets to the flat's single QR pass.
  perform public.issue_flat_sadya_qr(v_flat_id, v_event.id);

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after, reason)
    values (v_event.id, v_uid, 'sadya.recorded_offline', 'sadya_booking', v_booking.id,
            to_jsonb(v_booking), nullif(btrim(p_note), ''));

  return v_booking;
end;
$$;
grant execute on function public.record_offline_sadya(uuid, text, int, int, text, text) to authenticated;
