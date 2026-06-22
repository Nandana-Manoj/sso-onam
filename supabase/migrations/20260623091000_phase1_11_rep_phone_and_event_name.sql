-- Phase 1 · Migration 11 — Rep payment options + editable event name.
-- The rep stores a UPI ID (powers the resident's tap-to-pay button but is NOT
-- shown), a payment mobile number (shown + copyable), name/contact, and a QR.
-- Admins can also rename the active event via update_event_config.

alter table public.towers add column if not exists rep_payment_phone text;

-- set_my_rep_payment: contact + upi id + payment phone + qr (param list changes → drop first)
drop function if exists public.set_my_rep_payment(text, text, text);
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.app_role() <> 'tower_rep' then raise exception 'Tower reps only'; end if;

  update public.towers
     set rep_contact       = nullif(btrim(p_contact), ''),
         rep_upi_id        = nullif(btrim(p_upi_id), ''),
         rep_payment_phone = nullif(btrim(p_payment_phone), ''),
         payment_qr_path   = coalesce(nullif(btrim(p_qr_path), ''), payment_qr_path)
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
grant execute on function public.set_my_rep_payment(text, text, text, text) to authenticated;

-- update_event_config: add an editable name (param list changes → drop first)
drop function if exists public.update_event_config(uuid, numeric, numeric, numeric, timestamptz, timestamptz);
create or replace function public.update_event_config(
  p_event_id               uuid,
  p_name                   text        default null,
  p_min_contribution       numeric     default null,
  p_adult_price            numeric     default null,
  p_child_price            numeric     default null,
  p_booking_freeze_at      timestamptz default null,
  p_verification_cutoff_at timestamptz default null
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
     set name                   = coalesce(nullif(btrim(p_name), ''), name),
         min_contribution       = coalesce(p_min_contribution, min_contribution),
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
grant execute on function
  public.update_event_config(uuid, text, numeric, numeric, numeric, timestamptz, timestamptz)
  to authenticated;
