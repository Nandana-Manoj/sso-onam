-- Phase 1 · Migration 09 — Structured rep UPI ID (for tap-to-pay deep links).
-- rep_contact stays as an optional display name/phone; rep_upi_id is the bare
-- VPA used to build upi://pay links and the copyable UPI id residents see.

alter table public.towers add column if not exists rep_upi_id text;

drop function if exists public.set_my_rep_payment(text, text);

create or replace function public.set_my_rep_payment(
  p_contact text,
  p_upi_id  text,
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
         rep_upi_id      = nullif(btrim(p_upi_id), ''),
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

grant execute on function public.set_my_rep_payment(text, text, text) to authenticated;
