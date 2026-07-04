-- Phase 3 · Migration 05 — Fix a real concurrency bug found during the
-- pre-release data-integrity audit: four "decide" functions read the row to
-- act on with a plain SELECT (no lock), then check-and-branch on its status,
-- then UPDATE. That's a check-then-act race, not an atomic operation.
--
-- Two concurrent calls (a rep's accidental double-click, a flaky client
-- retrying an in-flight request, or two people racing each other) can both
-- read the row BEFORE either commits, both see the same "not yet decided"
-- status, and both pass the guard that's supposed to allow only one
-- decision. Confirmed empirically (not just by inspection) for
-- verify_contribution — a plain tower_rep's second concurrent call, which
-- should be refused ("Only submitted payments can be verified"), instead
-- went through, and the `overridden` flag — meant to flag a genuine
-- re-decision — silently stayed false because it was computed from each
-- transaction's own stale pre-update read. Net effect: two audit_log entries
-- for what the UI shows as one action, and a guard that a non-admin
-- shouldn't be able to bypass, bypassed by timing alone.
--
-- `redeem_sadya_pass` (phase3_01) and `decide_correction` (phase1_14)
-- already do this correctly with `for update` — this migration brings the
-- other four "decide" functions in line with that existing, correct pattern.
-- No behavior changes for any single, non-concurrent call.
--
-- Regression coverage: web/tests/integration/data-integrity.test.ts
-- ("a REP double-clicking ... is safely rejected", "CAVEAT: an ADMIN
-- double-clicking ...").

-- ---------------------------------------------------------------------------
-- 1. verify_contribution
-- ---------------------------------------------------------------------------
create or replace function public.verify_contribution(
  p_contribution_id uuid,
  p_approve         boolean,
  p_reason          text default null
) returns public.contributions
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_contrib  public.contributions;
  v_before   jsonb;
  v_settled  boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_contrib from public.contributions where id = p_contribution_id for update;
  if v_contrib is null then raise exception 'Contribution not found'; end if;

  if not (v_is_admin or public.is_rep_of(v_contrib.paid_to_tower_id)) then
    raise exception 'Not authorized to verify this payment';
  end if;

  v_settled := v_contrib.status in ('verified', 'rejected');
  if v_contrib.status not in ('submitted') and not v_is_admin then
    raise exception 'Only submitted payments can be verified';
  end if;

  v_before := to_jsonb(v_contrib);

  update public.contributions
     set status                = (case when p_approve then 'verified' else 'rejected' end)::txn_status,
         verified_by_user_id   = v_uid,
         verified_at           = now(),
         decision_reason       = nullif(btrim(p_reason), ''),
         overridden            = case when v_settled then true else overridden end,
         overridden_by_user_id = case when v_settled then v_uid else overridden_by_user_id end
   where id = p_contribution_id
   returning * into v_contrib;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, before, after, reason)
    values (
      v_contrib.event_id, v_uid,
      case when p_approve then 'contribution.verified' else 'contribution.rejected' end,
      'contribution', v_contrib.id, v_before, to_jsonb(v_contrib), nullif(btrim(p_reason), '')
    );

  return v_contrib;
end;
$$;
grant execute on function public.verify_contribution(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. verify_sadya_booking
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_booking from public.sadya_bookings where id = p_booking_id for update;
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

  -- Recompute the flat's single QR pass from all its verified bookings.
  perform public.issue_flat_sadya_qr(v_booking.flat_id, v_booking.event_id);

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
-- 3. process_refund
-- ---------------------------------------------------------------------------
create or replace function public.process_refund(
  p_contribution_id uuid,
  p_approve         boolean,
  p_reason          text default null
) returns public.contributions
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_contrib public.contributions;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_contrib from public.contributions where id = p_contribution_id for update;
  if v_contrib is null then raise exception 'Contribution not found'; end if;
  if not (public.is_admin() or public.is_rep_of(v_contrib.paid_to_tower_id)) then
    raise exception 'Not authorized to process this refund';
  end if;
  if v_contrib.refund_state is distinct from 'requested'::refund_state then
    raise exception 'No pending refund for this contribution';
  end if;

  if p_approve then
    update public.contributions
       set refund_state = 'refunded', refunded_at = now(), refunded_by_user_id = v_uid
     where id = p_contribution_id
     returning * into v_contrib;
  else
    update public.contributions
       set refund_state = null, refund_requested_at = null, refund_reason = null
     where id = p_contribution_id
     returning * into v_contrib;
  end if;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after, reason)
    values (
      v_contrib.event_id, v_uid,
      case when p_approve then 'contribution.refunded' else 'contribution.refund_rejected' end,
      'contribution', v_contrib.id, to_jsonb(v_contrib), nullif(btrim(p_reason), '')
    );

  return v_contrib;
end;
$$;
grant execute on function public.process_refund(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. process_sadya_cancellation
-- ---------------------------------------------------------------------------
create or replace function public.process_sadya_cancellation(
  p_cancellation_id uuid,
  p_approve         boolean,
  p_reason          text default null
) returns public.sadya_cancellations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.sadya_cancellations;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_row from public.sadya_cancellations where id = p_cancellation_id for update;
  if v_row is null then raise exception 'Cancellation not found'; end if;
  if not (public.is_admin() or public.is_rep_of(v_row.paid_to_tower_id)) then
    raise exception 'Not authorized to process this cancellation';
  end if;
  if v_row.status is distinct from 'requested'::refund_state then
    raise exception 'This cancellation has already been settled';
  end if;

  if p_approve then
    update public.sadya_cancellations
       set status = 'refunded', refunded_at = now(), refunded_by_user_id = v_uid
     where id = p_cancellation_id
     returning * into v_row;
    -- Tickets already left the QR at request time; nothing to recompute.
  else
    delete from public.sadya_cancellations where id = p_cancellation_id;
    -- Declining returns the tickets to the flat's QR.
    perform public.issue_flat_sadya_qr(v_row.flat_id, v_row.event_id);
  end if;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after, reason)
    values (
      v_row.event_id, v_uid,
      case when p_approve then 'sadya.cancellation_refunded' else 'sadya.cancellation_declined' end,
      'sadya_cancellation', v_row.id, to_jsonb(v_row), nullif(btrim(p_reason), '')
    );

  return v_row;
end;
$$;
grant execute on function public.process_sadya_cancellation(uuid, boolean, text) to authenticated;
