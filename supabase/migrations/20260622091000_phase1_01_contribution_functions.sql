-- Phase 1 · Migration 01 — Contribution money loop
-- create_contribution (flat-level, once per flat) -> submit payment -> verify.
-- All mutations go through these SECURITY DEFINER functions (clients have
-- SELECT-only RLS on contributions). Each function re-checks authorization.

-- ---------------------------------------------------------------------------
-- create_contribution — any flat member starts the flat's single contribution
-- for the active event. Amount must be >= the event minimum (snapshotted).
-- The partial-unique index (one live row per flat/event) enforces once-per-flat;
-- a concurrent attempt surfaces as a friendly "already in progress" error.
-- ---------------------------------------------------------------------------
create or replace function public.create_contribution(p_amount numeric)
returns public.contributions
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_prof    public.profiles;
  v_event   public.events;
  v_contrib public.contributions;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_prof from public.profiles where id = v_uid;
  if v_prof is null then raise exception 'Profile not found'; end if;
  if v_prof.flat_id is null then raise exception 'No flat is linked to your account'; end if;
  if v_prof.tower_id is null then raise exception 'No tower is linked to your account'; end if;

  select * into v_event from public.events where is_active limit 1;
  if v_event is null then raise exception 'No active event'; end if;

  if p_amount is null or p_amount < v_event.min_contribution then
    raise exception 'Amount must be at least %', v_event.min_contribution;
  end if;

  begin
    insert into public.contributions (
      event_id, flat_id, initiated_by_user_id,
      amount, min_snapshot, paid_to_tower_id, status
    ) values (
      v_event.id, v_prof.flat_id, v_uid,
      p_amount, v_event.min_contribution, v_prof.tower_id, 'payment_pending'
    )
    returning * into v_contrib;
  exception
    when unique_violation then
      raise exception 'A contribution for your flat is already in progress';
  end;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after)
    values (v_event.id, v_uid, 'contribution.created', 'contribution', v_contrib.id, to_jsonb(v_contrib));

  return v_contrib;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_contribution_payment — a flat member records what they paid to the
-- tower rep (amount + UTR). Moves payment_pending -> submitted.
-- ---------------------------------------------------------------------------
create or replace function public.submit_contribution_payment(
  p_contribution_id uuid,
  p_amount_paid     numeric,
  p_utr             text default null,
  p_screenshot_path text default null
) returns public.contributions
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_flat    uuid;
  v_contrib public.contributions;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select flat_id into v_flat from public.profiles where id = v_uid;

  select * into v_contrib from public.contributions where id = p_contribution_id;
  if v_contrib is null then raise exception 'Contribution not found'; end if;
  if not public.is_admin() and v_contrib.flat_id is distinct from v_flat then
    raise exception 'Not your flat''s contribution';
  end if;
  if v_contrib.status <> 'payment_pending' then
    raise exception 'Payment has already been submitted or processed';
  end if;
  if p_amount_paid is null or p_amount_paid <= 0 then
    raise exception 'Amount paid must be greater than zero';
  end if;

  update public.contributions
     set amount_paid          = p_amount_paid,
         utr                  = nullif(btrim(p_utr), ''),
         screenshot_path      = nullif(btrim(p_screenshot_path), ''),
         payment_submitted_at = now(),
         status               = 'submitted'
   where id = p_contribution_id
   returning * into v_contrib;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after)
    values (v_contrib.event_id, v_uid, 'contribution.payment_submitted', 'contribution', v_contrib.id, to_jsonb(v_contrib));

  return v_contrib;
end;
$$;

-- ---------------------------------------------------------------------------
-- verify_contribution — the tower rep for the paid-to tower (or an admin)
-- approves -> verified or rejects -> rejected. Admin re-deciding an already
-- settled record flips `overridden`. Rejection moves the row out of the
-- once-per-flat unique index, reopening the flat for a fresh attempt.
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

  select * into v_contrib from public.contributions where id = p_contribution_id;
  if v_contrib is null then raise exception 'Contribution not found'; end if;

  if not (v_is_admin
          or (public.app_role() = 'tower_rep'
              and v_contrib.paid_to_tower_id = public.app_tower_id())) then
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

-- ---------------------------------------------------------------------------
-- Execute grants (functions self-check authorization)
-- ---------------------------------------------------------------------------
grant execute on function
  public.create_contribution(numeric),
  public.submit_contribution_payment(uuid, numeric, text, text),
  public.verify_contribution(uuid, boolean, text)
  to authenticated;
