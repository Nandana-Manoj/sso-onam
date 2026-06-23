-- Phase 1 · Migration 12 — One account per mobile (data integrity across all
-- auth methods: mobile+password, Google, and future SMS OTP).
-- complete_registration now rejects an already-used mobile with a clear message
-- (instead of leaking the raw unique-constraint error), so whichever way a
-- person signs in, the profile's mobile stays the single dedup key.

create or replace function public.complete_registration(
  p_name        text,
  p_mobile      text,
  p_tower_id    uuid,
  p_flat_number text
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_uid         uuid := auth.uid();
  v_mobile      text := btrim(p_mobile);
  v_flat_number text := upper(nullif(btrim(p_flat_number), ''));
  v_flat_id     uuid;
  v_profile     public.profiles;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Profile already exists for this account';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Name is required'; end if;
  if v_mobile = '' then raise exception 'Mobile number is required'; end if;
  if p_tower_id is null then raise exception 'Tower is required'; end if;
  if v_flat_number is null then raise exception 'Flat number is required'; end if;
  if not exists (select 1 from public.towers where id = p_tower_id) then
    raise exception 'Invalid tower';
  end if;
  if exists (select 1 from public.profiles where mobile = v_mobile) then
    raise exception 'This mobile number is already registered. Please log in instead.';
  end if;

  select id into v_flat_id from public.flats
   where tower_id = p_tower_id and flat_number = v_flat_number;
  if v_flat_id is null then
    insert into public.flats (tower_id, flat_number)
      values (p_tower_id, v_flat_number)
      returning id into v_flat_id;
  end if;

  insert into public.profiles (id, name, mobile, role, tower_id, flat_id, claimed)
    values (v_uid, btrim(p_name), v_mobile, 'resident', p_tower_id, v_flat_id, true)
    returning * into v_profile;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, after)
    values (v_uid, 'profile.registered', 'profile', v_uid, to_jsonb(v_profile));

  return v_profile;
end;
$$;
