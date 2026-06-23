-- Phase 1 · Migration 13 — Cancel + refund flow for verified contributions.
-- Resident cancels a verified contribution → refund_state='requested' (rep is
-- notified). Rep marks it paid back → refund_state='refunded': it drops out of
-- collections AND frees the flat to contribute again (so the numbers tally).

create type refund_state as enum ('requested', 'refunded');

alter table public.contributions
  add column if not exists refund_state        refund_state,
  add column if not exists refund_reason        text,
  add column if not exists refund_requested_at  timestamptz,
  add column if not exists refunded_at           timestamptz,
  add column if not exists refunded_by_user_id   uuid references public.profiles(id);

-- A refunded contribution no longer holds the flat (they can pay again);
-- a 'requested' one still does (one refund at a time).
drop index if exists public.contributions_one_active_idx;
create unique index contributions_one_active_idx
  on public.contributions (flat_id, event_id)
  where status in ('payment_pending', 'submitted', 'verified')
    and refund_state is distinct from 'refunded'::refund_state;

-- ---------------------------------------------------------------------------
-- request_refund — a flat member (or admin) cancels a VERIFIED contribution.
-- ---------------------------------------------------------------------------
create or replace function public.request_refund(
  p_contribution_id uuid,
  p_reason          text default null
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
  if v_contrib.status <> 'verified' then
    raise exception 'Only a verified contribution can be cancelled for a refund';
  end if;
  if v_contrib.refund_state is not null then
    raise exception 'A refund is already in progress or completed';
  end if;

  update public.contributions
     set refund_state        = 'requested',
         refund_reason        = nullif(btrim(p_reason), ''),
         refund_requested_at  = now()
   where id = p_contribution_id
   returning * into v_contrib;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after, reason)
    values (v_contrib.event_id, v_uid, 'contribution.refund_requested', 'contribution', v_contrib.id,
            to_jsonb(v_contrib), nullif(btrim(p_reason), ''));

  return v_contrib;
end;
$$;
grant execute on function public.request_refund(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- process_refund — the rep (own tower) or admin settles a refund request.
-- approve = paid the resident back → 'refunded'; reject = back to collected.
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

  select * into v_contrib from public.contributions where id = p_contribution_id;
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
