-- Phase 3 · Migration 08 — Contribution refunds become an admin-only, one-step action.
-- Residents can no longer cancel a verified contribution / request a refund
-- themselves; only an admin can refund one, entering a reason as they do it.
-- Replaces the old two-step request_refund (resident/admin) → process_refund
-- (rep/admin) flow for CONTRIBUTIONS. Sadya ticket cancellations/refunds are
-- unaffected — residents can still request those and reps still settle them.

drop function if exists public.request_refund(uuid, text);

-- admin_refund_contribution — an admin directly refunds a VERIFIED contribution.
create or replace function public.admin_refund_contribution(
  p_contribution_id uuid,
  p_reason          text default null
) returns public.contributions
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_contrib public.contributions;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_admin() then raise exception 'Only an admin can refund a contribution'; end if;

  select * into v_contrib from public.contributions where id = p_contribution_id;
  if v_contrib is null then raise exception 'Contribution not found'; end if;
  if v_contrib.status <> 'verified' then
    raise exception 'Only a verified contribution can be refunded';
  end if;
  if v_contrib.refund_state is not null then
    raise exception 'A refund is already in progress or completed';
  end if;

  update public.contributions
     set refund_state        = 'refunded',
         refund_reason        = nullif(btrim(p_reason), ''),
         refund_requested_at  = now(),
         refunded_at          = now(),
         refunded_by_user_id  = v_uid
   where id = p_contribution_id
   returning * into v_contrib;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after, reason)
    values (v_contrib.event_id, v_uid, 'contribution.refunded', 'contribution', v_contrib.id,
            to_jsonb(v_contrib), nullif(btrim(p_reason), ''));

  return v_contrib;
end;
$$;
grant execute on function public.admin_refund_contribution(uuid, text) to authenticated;

-- process_refund is no longer reachable from the app (nothing sets
-- refund_state='requested' for contributions anymore) but is left in place,
-- admin-only, in case any pre-existing 'requested' rows need settling by hand.
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
  if not public.is_admin() then raise exception 'Only an admin can process this refund'; end if;

  select * into v_contrib from public.contributions where id = p_contribution_id;
  if v_contrib is null then raise exception 'Contribution not found'; end if;
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
