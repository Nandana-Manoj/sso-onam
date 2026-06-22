-- Phase 1 · Migration 08 — Admins cannot be tower reps; reps stay residents.
-- Supersedes the rep-management functions from migrations 05/07. An admin may
-- not be assigned as a tower rep. Tower reps remain residents at heart and keep
-- access to the resident experience (handled in the UI).

create or replace function public.assign_tower_rep(p_user_id uuid)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_target   public.profiles;
  v_prev_rep uuid;
  v_result   public.profiles;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;

  select * into v_target from public.profiles where id = p_user_id;
  if v_target is null then raise exception 'User not found'; end if;
  if v_target.role = 'admin' then raise exception 'An admin cannot be a tower rep'; end if;
  if v_target.tower_id is null then
    raise exception 'This resident has no tower set — they can only rep their own tower';
  end if;

  -- demote the tower's previous rep back to resident (if a different person)
  select rep_user_id into v_prev_rep from public.towers where id = v_target.tower_id;
  if v_prev_rep is not null and v_prev_rep <> p_user_id then
    update public.profiles set role = 'resident' where id = v_prev_rep and role = 'tower_rep';
  end if;

  update public.profiles
     set role = 'tower_rep', tower_id = v_target.tower_id
   where id = p_user_id
   returning * into v_result;

  update public.towers
     set rep_user_id = p_user_id, rep_contact = null, payment_qr_path = null
   where id = v_target.tower_id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, before, after)
    values (auth.uid(), 'rep.assigned', 'profile', p_user_id, to_jsonb(v_target), to_jsonb(v_result));

  return v_result;
end;
$$;

create or replace function public.remove_tower_rep(p_tower_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rep uuid;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;

  select rep_user_id into v_rep from public.towers where id = p_tower_id;
  if v_rep is null then raise exception 'This tower has no rep'; end if;

  update public.profiles set role = 'resident' where id = v_rep and role = 'tower_rep';
  update public.towers
     set rep_user_id = null, rep_contact = null, payment_qr_path = null
   where id = p_tower_id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id)
    values (auth.uid(), 'rep.removed', 'tower', p_tower_id);
end;
$$;

create or replace function public.set_my_rep_payment(
  p_contact text,
  p_qr_path text default null
) returns public.towers
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_tower public.towers;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.app_role() <> 'tower_rep' then raise exception 'Tower reps only'; end if;

  update public.towers
     set rep_contact     = nullif(btrim(p_contact), ''),
         payment_qr_path = coalesce(nullif(btrim(p_qr_path), ''), payment_qr_path)
   where rep_user_id = v_uid
   returning * into v_tower;

  if v_tower is null then
    raise exception 'You are not assigned as the rep for any tower';
  end if;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, after)
    values (v_uid, 'tower.rep_payment_updated', 'tower', v_tower.id, to_jsonb(v_tower));

  return v_tower;
end;
$$;
