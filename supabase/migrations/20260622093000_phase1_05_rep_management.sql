-- Phase 1 · Migration 05 — Rep management (admin add/remove), own-tower only.
-- A rep always represents their OWN registered tower (point 1). Reassigning a
-- tower demotes the previous rep and CLEARS the tower's payment details, so new
-- payments surface the new rep's UPI/QR. Already-verified contributions keep
-- their verified_by_user_id, so each rep's collections stay attributable across
-- a mid-event handover (point 2).

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
  if v_target.tower_id is null then
    raise exception 'This resident has no tower set — they can only rep their own tower';
  end if;

  -- demote the tower's existing rep, if a different person
  select rep_user_id into v_prev_rep from public.towers where id = v_target.tower_id;
  if v_prev_rep is not null and v_prev_rep <> p_user_id then
    update public.profiles set role = 'resident' where id = v_prev_rep;
  end if;

  -- promote target to rep of their own tower
  update public.profiles
     set role = 'tower_rep', tower_id = v_target.tower_id
   where id = p_user_id
   returning * into v_result;

  -- point the tower at the new rep; clear stale payment details so new
  -- payments show the new rep's data (they add their own UPI/QR).
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

  update public.profiles set role = 'resident' where id = v_rep;
  update public.towers
     set rep_user_id = null, rep_contact = null, payment_qr_path = null
   where id = p_tower_id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id)
    values (auth.uid(), 'rep.removed', 'tower', p_tower_id);
end;
$$;

grant execute on function
  public.assign_tower_rep(uuid),
  public.remove_tower_rep(uuid)
  to authenticated;
