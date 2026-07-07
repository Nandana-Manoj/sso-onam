-- Phase 3 · Migration 09 — Fix set_my_rep_payment for multi-tower reps.
-- `update ... returning * into v_tower` (v_tower is a single-row record)
-- raised "query returned more than one row" whenever a rep manages more
-- than one tower — the multi-tower rep model (phase1_10) was never
-- propagated into this function. Audit log now records every tower the
-- update touched, not just one.

create or replace function public.set_my_rep_payment(
  p_contact       text,
  p_upi_id        text,
  p_payment_phone text,
  p_qr_path       text default null
) returns public.towers
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_tower public.towers;
  v_count int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.app_role() <> 'tower_rep' then raise exception 'Tower reps only'; end if;

  update public.towers
     set rep_contact       = nullif(btrim(p_contact), ''),
         rep_upi_id        = nullif(btrim(p_upi_id), ''),
         rep_payment_phone = nullif(btrim(p_payment_phone), ''),
         payment_qr_path   = coalesce(nullif(btrim(p_qr_path), ''), payment_qr_path)
   where rep_user_id = v_uid;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'You are not assigned as the rep for any tower';
  end if;

  select * into v_tower from public.towers where rep_user_id = v_uid order by name limit 1;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, after)
    select v_uid, 'tower.rep_payment_updated', 'tower', t.id, to_jsonb(t)
      from public.towers t where t.rep_user_id = v_uid;

  return v_tower;
end;
$$;
grant execute on function public.set_my_rep_payment(text, text, text, text) to authenticated;
