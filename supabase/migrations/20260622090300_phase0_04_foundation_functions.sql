-- Phase 0 · Migration 04 — Foundation functions & triggers
-- updated_at maintenance, profile identity guard, resident registration,
-- admin role/event setup. (Money-loop RPCs — create_contribution,
-- verify_payment, redeem_qr, etc. — arrive in Phase 1.)

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_towers_updated   before update on public.towers
  for each row execute function public.set_updated_at();
create trigger trg_events_updated   before update on public.events
  for each row execute function public.set_updated_at();
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger trg_contributions_updated before update on public.contributions
  for each row execute function public.set_updated_at();
create trigger trg_sadya_updated    before update on public.sadya_bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Guard: residents/reps may not change their own role/tower/flat directly.
-- (Admin can; Phase-4 approve_correction() will handle resident moves.)
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if new.role     is distinct from old.role
       or new.tower_id is distinct from old.tower_id
       or new.flat_id  is distinct from old.flat_id then
      raise exception 'Changing role, tower, or flat requires admin/correction approval';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_guard_profile_identity before update on public.profiles
  for each row execute function public.guard_profile_identity();

-- ---------------------------------------------------------------------------
-- complete_registration — called right after auth.signUp (phone+password).
-- Creates the flat if needed and the resident profile, atomically.
-- ---------------------------------------------------------------------------
create or replace function public.complete_registration(
  p_name        text,
  p_mobile      text,
  p_tower_id    uuid,
  p_flat_number text
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_uid         uuid := auth.uid();
  v_flat_number text := upper(nullif(btrim(p_flat_number), ''));
  v_flat_id     uuid;
  v_profile     public.profiles;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Profile already exists for this account';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Name is required'; end if;
  if p_tower_id is null then raise exception 'Tower is required'; end if;
  if v_flat_number is null then raise exception 'Flat number is required'; end if;
  if not exists (select 1 from public.towers where id = p_tower_id) then
    raise exception 'Invalid tower';
  end if;

  -- find or create the flat under this tower (canonical normalized form)
  select id into v_flat_id from public.flats
   where tower_id = p_tower_id and flat_number = v_flat_number;
  if v_flat_id is null then
    insert into public.flats (tower_id, flat_number)
      values (p_tower_id, v_flat_number)
      returning id into v_flat_id;
  end if;

  insert into public.profiles (id, name, mobile, role, tower_id, flat_id, claimed)
    values (v_uid, btrim(p_name), btrim(p_mobile), 'resident', p_tower_id, v_flat_id, true)
    returning * into v_profile;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, after)
    values (v_uid, 'profile.registered', 'profile', v_uid, to_jsonb(v_profile));

  return v_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- grant_role — admin assigns role (+ tower for reps), sets tower's current rep.
-- ---------------------------------------------------------------------------
create or replace function public.grant_role(
  p_user_id  uuid,
  p_role     user_role,
  p_tower_id uuid default null
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_before  jsonb;
  v_profile public.profiles;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;

  select to_jsonb(p) into v_before from public.profiles p where id = p_user_id;
  if v_before is null then raise exception 'User not found'; end if;

  update public.profiles
     set role     = p_role,
         tower_id = coalesce(p_tower_id, tower_id)
   where id = p_user_id
   returning * into v_profile;

  if p_role = 'tower_rep' and p_tower_id is not null then
    update public.towers set rep_user_id = p_user_id where id = p_tower_id;
  end if;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, before, after)
    values (auth.uid(), 'role.granted', 'profile', p_user_id, v_before, to_jsonb(v_profile));

  return v_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_active_event — admin toggles the single active event.
-- ---------------------------------------------------------------------------
create or replace function public.set_active_event(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Event not found';
  end if;

  update public.events set is_active = false where is_active;        -- clear current
  update public.events set is_active = true  where id = p_event_id;  -- set new

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, event_id)
    values (auth.uid(), 'event.activated', 'event', p_event_id, p_event_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- update_event_config — admin edits event configuration (audited; never
-- retro-applied — records keep their own snapshots).
-- ---------------------------------------------------------------------------
create or replace function public.update_event_config(
  p_event_id                uuid,
  p_min_contribution        numeric     default null,
  p_adult_price             numeric     default null,
  p_child_price             numeric     default null,
  p_booking_freeze_at       timestamptz default null,
  p_verification_cutoff_at  timestamptz default null
) returns public.events
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_event  public.events;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;

  select to_jsonb(e) into v_before from public.events e where id = p_event_id;
  if v_before is null then raise exception 'Event not found'; end if;

  update public.events
     set min_contribution       = coalesce(p_min_contribution, min_contribution),
         adult_sadya_price      = coalesce(p_adult_price, adult_sadya_price),
         child_sadya_price      = coalesce(p_child_price, child_sadya_price),
         booking_freeze_at      = coalesce(p_booking_freeze_at, booking_freeze_at),
         verification_cutoff_at = coalesce(p_verification_cutoff_at, verification_cutoff_at)
   where id = p_event_id
   returning * into v_event;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, before, after, event_id)
    values (auth.uid(), 'event.config_updated', 'event', p_event_id, v_before, to_jsonb(v_event), p_event_id);

  return v_event;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute grants (authenticated callers; functions self-check authorization)
-- ---------------------------------------------------------------------------
grant execute on function
  public.complete_registration(text, text, uuid, text),
  public.grant_role(uuid, user_role, uuid),
  public.set_active_event(uuid),
  public.update_event_config(uuid, numeric, numeric, numeric, timestamptz, timestamptz)
  to authenticated;
