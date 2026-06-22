-- Phase 1 · Migration 10 — Multi-tower reps + admin grant/revoke.
-- New model: each tower has one rep (towers.rep_user_id), but a rep can manage
-- MANY towers and need not live in them. A rep's managed towers = the towers
-- whose rep_user_id is them; their residence (profiles.tower_id/flat_id) is
-- separate. Rep-scoped access therefore keys off is_rep_of(tower), not the
-- single app_tower_id().

-- ---------------------------------------------------------------------------
-- Helper: does the current user rep this tower?
-- ---------------------------------------------------------------------------
create or replace function public.is_rep_of(p_tower_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.towers where id = p_tower_id and rep_user_id = auth.uid()
  );
$$;
grant execute on function public.is_rep_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Rewrite rep-scoped RLS policies: tower = app_tower_id()  ->  is_rep_of(tower)
-- ---------------------------------------------------------------------------
drop policy if exists flats_select on public.flats;
create policy flats_select on public.flats for select to authenticated using (
  public.is_admin() or id = public.app_flat_id() or public.is_rep_of(tower_id)
);
drop policy if exists flats_write_rep_admin on public.flats;
create policy flats_write_rep_admin on public.flats for insert to authenticated with check (
  public.is_admin() or public.is_rep_of(tower_id)
);
drop policy if exists flats_update_rep_admin on public.flats;
create policy flats_update_rep_admin on public.flats for update to authenticated using (
  public.is_admin() or public.is_rep_of(tower_id)
) with check (
  public.is_admin() or public.is_rep_of(tower_id)
);

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or public.is_admin() or public.is_rep_of(tower_id)
);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (
  id = auth.uid() or public.is_admin() or public.is_rep_of(tower_id)
) with check (
  id = auth.uid() or public.is_admin() or public.is_rep_of(tower_id)
);

drop policy if exists corrections_select on public.correction_requests;
create policy corrections_select on public.correction_requests for select to authenticated using (
  public.is_admin() or profile_id = auth.uid()
  or public.is_rep_of(requested_tower_id) or public.is_rep_of(current_tower_id)
);

drop policy if exists contributions_select on public.contributions;
create policy contributions_select on public.contributions for select to authenticated using (
  public.is_admin() or flat_id = public.app_flat_id() or public.is_rep_of(paid_to_tower_id)
);

drop policy if exists sadya_select on public.sadya_bookings;
create policy sadya_select on public.sadya_bookings for select to authenticated using (
  public.is_admin() or resident_id = auth.uid() or public.is_rep_of(paid_to_tower_id)
);

drop policy if exists qr_select on public.qr_passes;
create policy qr_select on public.qr_passes for select to authenticated using (
  public.is_admin() or exists (
    select 1 from public.sadya_bookings b
    where b.id = qr_passes.booking_id
      and (b.resident_id = auth.uid() or public.is_rep_of(b.paid_to_tower_id))
  )
);

drop policy if exists redemptions_select on public.redemptions;
create policy redemptions_select on public.redemptions for select to authenticated using (
  public.is_admin() or exists (
    select 1 from public.qr_passes p
    join public.sadya_bookings b on b.id = p.booking_id
    where p.id = redemptions.qr_pass_id
      and (b.resident_id = auth.uid() or public.is_rep_of(b.paid_to_tower_id))
  )
);

drop policy if exists handovers_select on public.fund_handovers;
create policy handovers_select on public.fund_handovers for select to authenticated using (
  public.is_admin() or public.is_rep_of(tower_id)
);

-- ---------------------------------------------------------------------------
-- assign_tower_rep(user, tower) — assign a resident as the rep of ANY tower.
-- Residence (profiles.tower_id) is untouched. The tower's previous rep is
-- demoted only if they no longer manage any other tower.
-- ---------------------------------------------------------------------------
drop function if exists public.assign_tower_rep(uuid);
create or replace function public.assign_tower_rep(p_user_id uuid, p_tower_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles;
  v_prev   uuid;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_tower_id is null then raise exception 'Tower is required'; end if;

  select * into v_target from public.profiles where id = p_user_id;
  if v_target is null then raise exception 'User not found'; end if;
  if v_target.role = 'admin' then raise exception 'An admin cannot be a tower rep'; end if;

  select rep_user_id into v_prev from public.towers where id = p_tower_id;
  if v_prev is not null and v_prev <> p_user_id then
    if not exists (select 1 from public.towers where rep_user_id = v_prev and id <> p_tower_id) then
      update public.profiles set role = 'resident' where id = v_prev and role = 'tower_rep';
    end if;
  end if;

  update public.profiles set role = 'tower_rep' where id = p_user_id and role <> 'admin';
  update public.towers
     set rep_user_id = p_user_id, rep_contact = null, rep_upi_id = null, payment_qr_path = null
   where id = p_tower_id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id)
    values (auth.uid(), 'rep.assigned', 'tower', p_tower_id);
end;
$$;
grant execute on function public.assign_tower_rep(uuid, uuid) to authenticated;

-- remove_tower_rep(tower) — clear this tower's rep; demote them only if they
-- no longer manage any other tower.
create or replace function public.remove_tower_rep(p_tower_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_rep uuid;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select rep_user_id into v_rep from public.towers where id = p_tower_id;
  if v_rep is null then raise exception 'This tower has no rep'; end if;

  update public.towers
     set rep_user_id = null, rep_contact = null, rep_upi_id = null, payment_qr_path = null
   where id = p_tower_id;

  if not exists (select 1 from public.towers where rep_user_id = v_rep) then
    update public.profiles set role = 'resident' where id = v_rep and role = 'tower_rep';
  end if;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id)
    values (auth.uid(), 'rep.removed', 'tower', p_tower_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin grant/revoke (#1). Promoting to admin clears any rep assignments
-- (admins are not reps). Cannot revoke yourself or the last admin.
-- ---------------------------------------------------------------------------
create or replace function public.grant_admin(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found';
  end if;

  -- step down from any tower-rep duties (a tower they rep loses its rep)
  update public.towers
     set rep_user_id = null, rep_contact = null, rep_upi_id = null, payment_qr_path = null
   where rep_user_id = p_user_id;

  update public.profiles set role = 'admin' where id = p_user_id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id)
    values (auth.uid(), 'admin.granted', 'profile', p_user_id);
end;
$$;
grant execute on function public.grant_admin(uuid) to authenticated;

create or replace function public.revoke_admin(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot revoke your own admin access'; end if;
  if (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Cannot remove the last admin';
  end if;

  update public.profiles set role = 'resident' where id = p_user_id and role = 'admin';

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id)
    values (auth.uid(), 'admin.revoked', 'profile', p_user_id);
end;
$$;
grant execute on function public.revoke_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Update rep authorization in existing money functions to multi-tower.
-- ---------------------------------------------------------------------------
create or replace function public.verify_contribution(
  p_contribution_id uuid,
  p_approve         boolean,
  p_reason          text default null
) returns public.contributions
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_contrib  public.contributions;
  v_before   jsonb;
  v_settled  boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_contrib from public.contributions where id = p_contribution_id;
  if v_contrib is null then raise exception 'Contribution not found'; end if;

  if not (v_is_admin or public.is_rep_of(v_contrib.paid_to_tower_id)) then
    raise exception 'Not authorized to verify this payment';
  end if;

  v_settled := v_contrib.status in ('verified', 'rejected');
  if v_contrib.status not in ('submitted') and not v_is_admin then
    raise exception 'Only submitted payments can be verified';
  end if;

  v_before := to_jsonb(v_contrib);

  update public.contributions
     set status                = (case when p_approve then 'verified' else 'rejected' end)::txn_status,
         verified_by_user_id   = v_uid,
         verified_at           = now(),
         decision_reason       = nullif(btrim(p_reason), ''),
         overridden            = case when v_settled then true else overridden end,
         overridden_by_user_id = case when v_settled then v_uid else overridden_by_user_id end
   where id = p_contribution_id
   returning * into v_contrib;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, before, after, reason)
    values (
      v_contrib.event_id, v_uid,
      case when p_approve then 'contribution.verified' else 'contribution.rejected' end,
      'contribution', v_contrib.id, v_before, to_jsonb(v_contrib), nullif(btrim(p_reason), '')
    );

  return v_contrib;
end;
$$;

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
  if not (v_is_admin or public.is_rep_of(p_tower_id)) then
    raise exception 'Not authorized to record payments for this tower';
  end if;
  if v_flat_number is null then raise exception 'Flat number is required'; end if;

  select * into v_event from public.events where is_active limit 1;
  if v_event is null then raise exception 'No active event'; end if;
  if p_amount is null or p_amount < v_event.min_contribution then
    raise exception 'Amount must be at least %', v_event.min_contribution;
  end if;

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
