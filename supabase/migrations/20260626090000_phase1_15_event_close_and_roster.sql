-- Phase 1 · Migration 15 — Event lifecycle (open → closed) + per-event roster.
-- Closing the open event FREEZES a snapshot (admins, per-tower reps, per-tower /
-- per-rep collections, totals) into event_archives, so "who were the reps and
-- admins for event X" never drifts when reps/admins change for the next event.
-- Reps live on towers.rep_user_id (current only) and admins on profiles.role, so
-- without this snapshot that history would be lost. Only one event is open
-- (is_active) at a time — unchanged (events_one_active_idx still enforces it).

-- ---------------------------------------------------------------------------
-- events: lifecycle columns. `status` is derived (stored generated):
--   closed_at set        -> 'closed'
--   else is_active        -> 'open'
--   else                  -> 'draft'
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists closed_at         timestamptz,
  add column if not exists closed_by_user_id uuid references public.profiles(id);

alter table public.events
  add column if not exists status text
  generated always as (
    case when closed_at is not null then 'closed'
         when is_active then 'open'
         else 'draft' end
  ) stored;

-- ---------------------------------------------------------------------------
-- event_archives — frozen roster + collections snapshot per closed event.
-- Holds rep/admin PII (mobiles), so unlike events (world-readable to any
-- authenticated user) this is admin-only. Written only by the functions below.
-- ---------------------------------------------------------------------------
create table if not exists public.event_archives (
  event_id           uuid primary key references public.events(id) on delete cascade,
  data               jsonb not null,
  created_at         timestamptz not null default now(),
  created_by_user_id uuid references public.profiles(id)
);
alter table public.event_archives enable row level security;
drop policy if exists event_archives_admin_select on public.event_archives;
create policy event_archives_admin_select on public.event_archives
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- build_event_archive — compute the roster + collections snapshot for an event
-- from current reps/admins + this event's verified contributions. Admin-only;
-- NOT granted to clients (used internally by close_event / get_event_roster).
-- ---------------------------------------------------------------------------
create or replace function public.build_event_archive(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_data jsonb;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Event not found';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'config', (
      select jsonb_build_object(
        'name', e.name, 'year', e.year,
        'min_contribution', e.min_contribution,
        'adult_sadya_price', e.adult_sadya_price,
        'child_sadya_price', e.child_sadya_price
      ) from public.events e where e.id = p_event_id
    ),
    'admins', (
      select coalesce(jsonb_agg(
        jsonb_build_object('user_id', p.id, 'name', p.name, 'mobile', p.mobile)
        order by p.name
      ), '[]'::jsonb)
      from public.profiles p where p.role = 'admin'
    ),
    'towers', (
      select coalesce(jsonb_agg(t_obj order by t_name), '[]'::jsonb)
      from (
        select t.name as t_name,
          jsonb_build_object(
            'tower_id', t.id,
            'name', t.name,
            'rep_user_id', t.rep_user_id,
            'rep_name', rp.name,
            'rep_mobile', rp.mobile,
            'collected_verified', coalesce(cc.collected, 0),
            'contributions_count', coalesce(cc.cnt, 0),
            'flats_paid', coalesce(cc.flats_paid, 0)
          ) as t_obj
        from public.towers t
        left join public.profiles rp on rp.id = t.rep_user_id
        left join (
          select paid_to_tower_id,
                 sum(coalesce(amount_paid, amount)) as collected,
                 count(*)                           as cnt,
                 count(distinct flat_id)            as flats_paid
          from public.contributions
          where event_id = p_event_id
            and status = 'verified'
            and refund_state is distinct from 'refunded'::refund_state
          group by paid_to_tower_id
        ) cc on cc.paid_to_tower_id = t.id
      ) s
    ),
    'reps', (
      select coalesce(jsonb_agg(r_obj order by r_name), '[]'::jsonb)
      from (
        select rp.name as r_name,
          jsonb_build_object(
            'user_id', rp.id, 'name', rp.name, 'mobile', rp.mobile,
            'collected_verified', sum(coalesce(c.amount_paid, c.amount)),
            'contributions_count', count(*)
          ) as r_obj
        from public.contributions c
        join public.profiles rp on rp.id = c.paid_to_rep_user_id
        where c.event_id = p_event_id
          and c.status = 'verified'
          and c.refund_state is distinct from 'refunded'::refund_state
        group by rp.id, rp.name, rp.mobile
      ) s
    ),
    'totals', (
      select jsonb_build_object(
        'collected_verified', coalesce(sum(coalesce(amount_paid, amount))
            filter (where status = 'verified' and refund_state is distinct from 'refunded'::refund_state), 0),
        'refunded', coalesce(sum(coalesce(amount_paid, amount))
            filter (where refund_state = 'refunded'), 0),
        'contributions_verified', count(*)
            filter (where status = 'verified' and refund_state is distinct from 'refunded'::refund_state),
        'flats_total', (select count(*) from public.flats),
        'flats_paid', count(distinct flat_id)
            filter (where status = 'verified' and refund_state is distinct from 'refunded'::refund_state)
      )
      from public.contributions where event_id = p_event_id
    )
  ) into v_data;

  return v_data;
end;
$$;
revoke all on function public.build_event_archive(uuid) from public;

-- ---------------------------------------------------------------------------
-- close_event — admin freezes the snapshot and marks the event closed. The
-- event leaves the active slot, so a new one must be created/opened to continue.
-- ---------------------------------------------------------------------------
create or replace function public.close_event(p_event_id uuid)
returns public.events language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_event public.events;
  v_data  jsonb;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event is null then raise exception 'Event not found'; end if;
  if v_event.closed_at is not null then raise exception 'Event is already closed'; end if;
  if not v_event.is_active then raise exception 'Only the open event can be closed'; end if;

  v_data := public.build_event_archive(p_event_id);

  insert into public.event_archives (event_id, data, created_by_user_id)
    values (p_event_id, v_data, v_uid)
    on conflict (event_id)
      do update set data = excluded.data, created_at = now(), created_by_user_id = v_uid;

  update public.events
     set is_active = false, closed_at = now(), closed_by_user_id = v_uid
   where id = p_event_id
   returning * into v_event;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after)
    values (p_event_id, v_uid, 'event.closed', 'event', p_event_id, v_data);

  return v_event;
end;
$$;
grant execute on function public.close_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reopen_event — admin un-closes a closed event (the snapshot is discarded and
-- will be rebuilt on the next close). Refuses if another event is already open.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_event(p_event_id uuid)
returns public.events language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_event public.events;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event is null then raise exception 'Event not found'; end if;
  if v_event.closed_at is null then raise exception 'Event is not closed'; end if;
  if exists (select 1 from public.events where is_active) then
    raise exception 'Close the currently open event before reopening another';
  end if;

  update public.events
     set is_active = true, closed_at = null, closed_by_user_id = null
   where id = p_event_id
   returning * into v_event;

  delete from public.event_archives where event_id = p_event_id;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id)
    values (p_event_id, v_uid, 'event.reopened', 'event', p_event_id);

  return v_event;
end;
$$;
grant execute on function public.reopen_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_event_roster — admin reads the roster for any event: the frozen snapshot
-- for a closed event, or a live build for the open / draft event.
-- ---------------------------------------------------------------------------
create or replace function public.get_event_roster(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_event public.events;
  v_data  jsonb;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into v_event from public.events where id = p_event_id;
  if v_event is null then raise exception 'Event not found'; end if;

  if v_event.closed_at is not null then
    select data into v_data from public.event_archives where event_id = p_event_id;
    if v_data is null then v_data := public.build_event_archive(p_event_id); end if;  -- fallback
  else
    v_data := public.build_event_archive(p_event_id);
  end if;

  return v_data;
end;
$$;
grant execute on function public.get_event_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_active_event — redefined to refuse activating a CLOSED event (reopen it
-- instead, so closed_at is cleared and status stays consistent).
-- ---------------------------------------------------------------------------
create or replace function public.set_active_event(p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Event not found';
  end if;
  if exists (select 1 from public.events where id = p_event_id and closed_at is not null) then
    raise exception 'This event is closed — reopen it instead of setting it active';
  end if;

  update public.events set is_active = false where is_active;        -- clear current
  update public.events set is_active = true  where id = p_event_id;  -- set new

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, event_id)
    values (auth.uid(), 'event.activated', 'event', p_event_id, p_event_id);
end;
$$;
