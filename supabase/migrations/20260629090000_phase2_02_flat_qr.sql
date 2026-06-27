-- Phase 2 · Migration 02 — One sadya QR per FLAT (not per booking).
-- A flat gets a SINGLE QR pass whose allowed_scans = the total persons across all
-- of that flat's VERIFIED sadya bookings (any resident of the flat, any number of
-- bookings). Verifying another booking grows the same pass instead of minting a
-- new QR. Scanning/redemption still lands in Phase 3 — this only changes issuance.

-- ---------------------------------------------------------------------------
-- qr_passes: re-key from booking -> (event_id, flat_id).
-- booking_id is retired (kept nullable so the column/FK doesn't need dropping).
-- ---------------------------------------------------------------------------
alter table public.qr_passes
  add column if not exists flat_id uuid references public.flats(id);

alter table public.qr_passes drop constraint if exists qr_passes_booking_id_key;
alter table public.qr_passes alter column booking_id drop not null;

-- Pre-launch, with no redemptions yet, drop existing per-booking passes so they
-- can be re-issued per flat cleanly by the backfill below.
delete from public.qr_passes;

create unique index if not exists qr_passes_flat_event_idx
  on public.qr_passes (event_id, flat_id);
create index if not exists qr_passes_flat_idx on public.qr_passes (flat_id);

-- ---------------------------------------------------------------------------
-- issue_flat_sadya_qr — (re)compute a flat's single QR pass from its verified
-- bookings. Internal helper (not granted to clients); called on every verify.
--   sum > 0 : upsert the pass, allowed_scans = sum, status recomputed vs scans
--   sum = 0 : drop the pass (or void it if it already has redemptions)
-- ---------------------------------------------------------------------------
create or replace function public.issue_flat_sadya_qr(p_flat_id uuid, p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total int;
begin
  if p_flat_id is null then return; end if;

  select coalesce(sum(total_persons), 0) into v_total
    from public.sadya_bookings
   where flat_id = p_flat_id and event_id = p_event_id and status = 'verified';

  if v_total <= 0 then
    delete from public.qr_passes
     where flat_id = p_flat_id and event_id = p_event_id and redeemed_count = 0;
    update public.qr_passes set status = 'void'
     where flat_id = p_flat_id and event_id = p_event_id;   -- any left had redemptions
    return;
  end if;

  insert into public.qr_passes (event_id, flat_id, allowed_scans, nonce, status)
    values (p_event_id, p_flat_id, v_total,
            replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'issued')
  on conflict (event_id, flat_id) do update
    set allowed_scans = excluded.allowed_scans,
        status = (case
                    when qr_passes.redeemed_count >= excluded.allowed_scans then 'fully_redeemed'
                    when qr_passes.redeemed_count > 0                        then 'partially_redeemed'
                    else 'issued'
                  end)::qr_status;
end;
$$;
revoke all on function public.issue_flat_sadya_qr(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- verify_sadya_booking — same as phase2_01 but issues the FLAT's pass (via the
-- helper) instead of a per-booking pass. Re-decisions recompute the flat total.
-- ---------------------------------------------------------------------------
create or replace function public.verify_sadya_booking(
  p_booking_id uuid,
  p_approve    boolean,
  p_reason     text default null
) returns public.sadya_bookings
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_booking  public.sadya_bookings;
  v_before   jsonb;
  v_settled  boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_booking from public.sadya_bookings where id = p_booking_id;
  if v_booking is null then raise exception 'Booking not found'; end if;

  if not (v_is_admin or public.is_rep_of(v_booking.paid_to_tower_id)) then
    raise exception 'Not authorized to verify this booking';
  end if;

  v_settled := v_booking.status in ('verified', 'rejected');
  if v_booking.status <> 'submitted' and not v_is_admin then
    raise exception 'Only submitted bookings can be verified';
  end if;

  v_before := to_jsonb(v_booking);

  update public.sadya_bookings
     set status                = (case when p_approve then 'verified' else 'rejected' end)::txn_status_sadya,
         verified_by_user_id   = v_uid,
         verified_at           = now(),
         decision_reason       = nullif(btrim(p_reason), ''),
         overridden            = case when v_settled then true else overridden end,
         overridden_by_user_id = case when v_settled then v_uid else overridden_by_user_id end
   where id = p_booking_id
   returning * into v_booking;

  -- Recompute the flat's single QR pass from all its verified bookings.
  perform public.issue_flat_sadya_qr(v_booking.flat_id, v_booking.event_id);

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, before, after, reason)
    values (
      v_booking.event_id, v_uid,
      case when p_approve then 'sadya.verified' else 'sadya.rejected' end,
      'sadya_booking', v_booking.id, v_before, to_jsonb(v_booking), nullif(btrim(p_reason), '')
    );

  return v_booking;
end;
$$;
grant execute on function public.verify_sadya_booking(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: qr_passes / redemptions now key on flat (via flat_id) instead of booking.
-- ---------------------------------------------------------------------------
drop policy if exists qr_select on public.qr_passes;
create policy qr_select on public.qr_passes for select to authenticated using (
  public.is_admin()
  or flat_id = public.app_flat_id()
  or exists (select 1 from public.flats f where f.id = qr_passes.flat_id and public.is_rep_of(f.tower_id))
);

drop policy if exists redemptions_select on public.redemptions;
create policy redemptions_select on public.redemptions for select to authenticated using (
  public.is_admin()
  or exists (
    select 1 from public.qr_passes p
    join public.flats f on f.id = p.flat_id
    where p.id = redemptions.qr_pass_id
      and (f.id = public.app_flat_id() or public.is_rep_of(f.tower_id))
  )
);

-- ---------------------------------------------------------------------------
-- Backfill: re-issue a pass for every flat that already has verified bookings.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select distinct flat_id, event_id
    from public.sadya_bookings
    where status = 'verified' and flat_id is not null
  loop
    perform public.issue_flat_sadya_qr(r.flat_id, r.event_id);
  end loop;
end $$;
