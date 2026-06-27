-- Phase 2 · Migration 01 — Sadya booking loop + QR passes
-- Mirrors the contribution loop (create -> pay -> verify) but per RESIDENT and
-- with MULTIPLE bookings allowed (no resident-uniqueness). On verify a QR pass
-- is issued (one per booking, redeemable total_persons times — scanning lands in
-- Phase 3). All mutations go through these SECURITY DEFINER functions; clients
-- keep the SELECT-only RLS already defined in phase0_03 / phase1_10.
--
-- Gate: residents can only book while an admin has opened sadya for the active
-- event (events.sadya_open). Otherwise the resident UI shows a dormant card.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists sadya_open boolean not null default false;

-- Snapshot the receiving rep at payment-submit time (mirrors contributions,
-- phase1_06) so a booking stays credited to whoever actually received the money.
alter table public.sadya_bookings
  add column if not exists paid_to_rep_user_id uuid references public.profiles(id);
create index if not exists sadya_paid_rep_idx
  on public.sadya_bookings (paid_to_rep_user_id);

-- ---------------------------------------------------------------------------
-- set_sadya_open — admin opens/closes sadya booking for an event.
-- ---------------------------------------------------------------------------
create or replace function public.set_sadya_open(p_event_id uuid, p_open boolean)
returns public.events
language plpgsql security definer set search_path = public as $$
declare v_event public.events;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;

  update public.events set sadya_open = coalesce(p_open, false)
   where id = p_event_id
   returning * into v_event;
  if v_event is null then raise exception 'Event not found'; end if;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after)
    values (p_event_id, auth.uid(),
            case when p_open then 'event.sadya_opened' else 'event.sadya_closed' end,
            'event', p_event_id, to_jsonb(v_event));

  return v_event;
end;
$$;
grant execute on function public.set_sadya_open(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- create_sadya_booking — a resident starts a booking for the active event.
-- Multiple bookings per resident are allowed (e.g. family + guests). Prices are
-- snapshotted; the resident pays their own tower's rep (decentralized model).
-- ---------------------------------------------------------------------------
create or replace function public.create_sadya_booking(
  p_num_adults   int,
  p_num_children int
) returns public.sadya_bookings
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_prof    public.profiles;
  v_event   public.events;
  v_adults  int := coalesce(p_num_adults, 0);
  v_children int := coalesce(p_num_children, 0);
  v_total   numeric(10,2);
  v_booking public.sadya_bookings;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_prof from public.profiles where id = v_uid;
  if v_prof is null then raise exception 'Profile not found'; end if;
  if v_prof.tower_id is null then raise exception 'No tower is linked to your account'; end if;

  select * into v_event from public.events where is_active limit 1;
  if v_event is null then raise exception 'No active event'; end if;
  if not v_event.sadya_open then raise exception 'Sadya booking isn''t open yet'; end if;
  if v_event.booking_freeze_at is not null and now() >= v_event.booking_freeze_at then
    raise exception 'Sadya booking has closed for this event';
  end if;

  if v_adults < 0 or v_children < 0 then raise exception 'Counts cannot be negative'; end if;
  if (v_adults + v_children) < 1 then raise exception 'Add at least one person'; end if;

  v_total := v_adults * v_event.adult_sadya_price + v_children * v_event.child_sadya_price;

  insert into public.sadya_bookings (
    event_id, resident_id, flat_id, num_adults, num_children,
    adult_price_snapshot, child_price_snapshot, total_amount,
    paid_to_tower_id, status
  ) values (
    v_event.id, v_uid, v_prof.flat_id, v_adults, v_children,
    v_event.adult_sadya_price, v_event.child_sadya_price, v_total,
    v_prof.tower_id, 'payment_pending'
  )
  returning * into v_booking;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after)
    values (v_event.id, v_uid, 'sadya.created', 'sadya_booking', v_booking.id, to_jsonb(v_booking));

  return v_booking;
end;
$$;
grant execute on function public.create_sadya_booking(int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_sadya_payment — resident records what they paid the rep (amount + UTR).
-- payment_pending -> submitted; snapshots the receiving rep. Mirrors
-- submit_contribution_payment (phase1_06).
-- ---------------------------------------------------------------------------
create or replace function public.submit_sadya_payment(
  p_booking_id      uuid,
  p_amount_paid     numeric,
  p_utr             text default null,
  p_screenshot_path text default null
) returns public.sadya_bookings
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_booking public.sadya_bookings;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_booking from public.sadya_bookings where id = p_booking_id;
  if v_booking is null then raise exception 'Booking not found'; end if;
  if not public.is_admin() and v_booking.resident_id is distinct from v_uid then
    raise exception 'Not your booking';
  end if;
  if v_booking.status <> 'payment_pending' then
    raise exception 'Payment has already been submitted or processed';
  end if;
  if p_amount_paid is null or p_amount_paid <= 0 then
    raise exception 'Amount paid must be greater than zero';
  end if;

  update public.sadya_bookings
     set amount_paid          = p_amount_paid,
         utr                  = nullif(btrim(p_utr), ''),
         screenshot_path      = nullif(btrim(p_screenshot_path), ''),
         payment_submitted_at = now(),
         paid_to_rep_user_id  = (select rep_user_id from public.towers where id = v_booking.paid_to_tower_id),
         status               = 'submitted'
   where id = p_booking_id
   returning * into v_booking;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after)
    values (v_booking.event_id, v_uid, 'sadya.payment_submitted', 'sadya_booking', v_booking.id, to_jsonb(v_booking));

  return v_booking;
end;
$$;
grant execute on function public.submit_sadya_payment(uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- verify_sadya_booking — the rep for the paid-to tower (or admin) approves ->
-- verified (and issues the QR pass) or rejects -> rejected. Admin re-deciding a
-- settled booking flips `overridden`. Mirrors verify_contribution (phase1_01/10).
-- QR issuance is idempotent (qr_passes.booking_id is unique).
-- ---------------------------------------------------------------------------
create or replace function public.verify_sadya_booking(
  p_booking_id uuid,
  p_approve    boolean,
  p_reason     text default null
) returns public.sadya_bookings
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_booking  public.sadya_bookings;
  v_before   jsonb;
  v_settled  boolean;
  v_pass     public.qr_passes;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_booking from public.sadya_bookings where id = p_booking_id;
  if v_booking is null then raise exception 'Booking not found'; end if;

  if not (v_is_admin or public.is_rep_of(v_booking.paid_to_tower_id)) then
    raise exception 'Not authorized to verify this booking';
  end if;

  v_settled := v_booking.status in ('verified', 'rejected');
  if v_booking.status <> 'submitted' and not v_is_admin then
    raise exception 'Only submitted bookings can be verified';
  end if;

  v_before := to_jsonb(v_booking);

  update public.sadya_bookings
     set status                = (case when p_approve then 'verified' else 'rejected' end)::txn_status_sadya,
         verified_by_user_id   = v_uid,
         verified_at           = now(),
         decision_reason       = nullif(btrim(p_reason), ''),
         overridden            = case when v_settled then true else overridden end,
         overridden_by_user_id = case when v_settled then v_uid else overridden_by_user_id end
   where id = p_booking_id
   returning * into v_booking;

  -- Issue the QR pass on approval (one per booking; safe to re-run).
  -- Nonce: two gen_random_uuid()s (a pg_catalog built-in — avoids depending on
  -- pgcrypto's gen_random_bytes, which lives in the `extensions` schema and is
  -- not on this function's search_path) → 64 opaque hex chars.
  if p_approve then
    insert into public.qr_passes (booking_id, event_id, allowed_scans, nonce, status)
      values (v_booking.id, v_booking.event_id, v_booking.total_persons,
              replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'issued')
      on conflict (booking_id) do nothing
      returning * into v_pass;

    if v_pass.id is not null then
      insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after)
        values (v_booking.event_id, v_uid, 'qr.issued', 'qr_pass', v_pass.id, to_jsonb(v_pass));
    end if;
  end if;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, before, after, reason)
    values (
      v_booking.event_id, v_uid,
      case when p_approve then 'sadya.verified' else 'sadya.rejected' end,
      'sadya_booking', v_booking.id, v_before, to_jsonb(v_booking), nullif(btrim(p_reason), '')
    );

  return v_booking;
end;
$$;
grant execute on function public.verify_sadya_booking(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_sadya_booking — resident (own) or admin cancels a NON-verified booking
-- (payment_pending / submitted) so a mistaken count can be redone. Refunds for
-- already-verified sadya are out of scope this phase (see phase1_13 if needed).
-- ---------------------------------------------------------------------------
create or replace function public.cancel_sadya_booking(
  p_booking_id uuid,
  p_reason     text default null
) returns public.sadya_bookings
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_booking public.sadya_bookings;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_booking from public.sadya_bookings where id = p_booking_id;
  if v_booking is null then raise exception 'Booking not found'; end if;
  if not public.is_admin() and v_booking.resident_id is distinct from v_uid then
    raise exception 'Not your booking';
  end if;
  if v_booking.status not in ('payment_pending', 'submitted') then
    raise exception 'Only a booking that is not yet verified can be cancelled';
  end if;

  update public.sadya_bookings
     set status          = 'cancelled',
         decision_reason = nullif(btrim(p_reason), '')
   where id = p_booking_id
   returning * into v_booking;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after, reason)
    values (v_booking.event_id, v_uid, 'sadya.cancelled', 'sadya_booking', v_booking.id,
            to_jsonb(v_booking), nullif(btrim(p_reason), ''));

  return v_booking;
end;
$$;
grant execute on function public.cancel_sadya_booking(uuid, text) to authenticated;
