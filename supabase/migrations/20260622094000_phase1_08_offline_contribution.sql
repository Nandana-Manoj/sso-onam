-- Phase 1 · Migration 08 — Record an offline / walk-in contribution.
-- For residents who pay the rep directly without using the app. A tower rep
-- (own tower) or an admin (any tower) records it; it lands as 'verified'
-- immediately (the rep received the money). Creates the flat if needed and
-- respects the once-per-flat-per-event guard.

create or replace function public.record_offline_contribution(
  p_tower_id    uuid,
  p_flat_number text,
  p_amount      numeric,
  p_utr         text default null,
  p_note        text default null
) returns public.contributions
language plpgsql security definer set search_path = public as $$
declare
  v_uid         uuid := auth.uid();
  v_is_admin    boolean := public.is_admin();
  v_event       public.events;
  v_flat_number text := upper(nullif(btrim(p_flat_number), ''));
  v_flat_id     uuid;
  v_rep         uuid;
  v_contrib     public.contributions;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_tower_id is null then raise exception 'Tower is required'; end if;
  if not (v_is_admin or (public.app_role() = 'tower_rep' and p_tower_id = public.app_tower_id())) then
    raise exception 'Not authorized to record payments for this tower';
  end if;
  if v_flat_number is null then raise exception 'Flat number is required'; end if;

  select * into v_event from public.events where is_active limit 1;
  if v_event is null then raise exception 'No active event'; end if;
  if p_amount is null or p_amount < v_event.min_contribution then
    raise exception 'Amount must be at least %', v_event.min_contribution;
  end if;

  -- find or create the flat under this tower
  select id into v_flat_id from public.flats where tower_id = p_tower_id and flat_number = v_flat_number;
  if v_flat_id is null then
    insert into public.flats (tower_id, flat_number) values (p_tower_id, v_flat_number) returning id into v_flat_id;
  end if;

  select rep_user_id into v_rep from public.towers where id = p_tower_id;

  begin
    insert into public.contributions (
      event_id, flat_id, initiated_by_user_id, amount, min_snapshot, status,
      paid_to_tower_id, paid_to_rep_user_id, amount_paid, utr,
      payment_submitted_at, verified_by_user_id, verified_at, decision_reason
    ) values (
      v_event.id, v_flat_id, v_uid, p_amount, v_event.min_contribution, 'verified',
      p_tower_id, coalesce(v_rep, v_uid), p_amount, nullif(btrim(p_utr), ''),
      now(), v_uid, now(), nullif(btrim(p_note), '')
    ) returning * into v_contrib;
  exception
    when unique_violation then
      raise exception 'A contribution for this flat already exists for this event';
  end;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after, reason)
    values (v_event.id, v_uid, 'contribution.recorded_offline', 'contribution', v_contrib.id,
            to_jsonb(v_contrib), nullif(btrim(p_note), ''));

  return v_contrib;
end;
$$;

grant execute on function public.record_offline_contribution(uuid, text, numeric, text, text) to authenticated;
