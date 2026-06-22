-- Phase 1 · Migration 02 — Rep self-service payment details
-- A tower rep sets the UPI/contact residents see when paying. Scoped so a rep
-- can only edit their OWN tower's rep_contact (not rename towers or reassign
-- reps), via a SECURITY DEFINER function rather than a broad RLS update grant.

create or replace function public.set_my_rep_payment(p_contact text)
returns public.towers
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_tower public.towers;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.app_role() <> 'tower_rep' then raise exception 'Tower reps only'; end if;

  update public.towers
     set rep_contact = nullif(btrim(p_contact), '')
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

grant execute on function public.set_my_rep_payment(text) to authenticated;
