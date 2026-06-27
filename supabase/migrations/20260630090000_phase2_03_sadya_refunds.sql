-- Phase 2 · Migration 03 — Partial sadya cancellation + refund (per ticket).
-- A resident cancels a chosen number of tickets (adults / children) across their
-- VERIFIED bookings — not a whole booking. Each request is one row the tower rep
-- settles (pays back → 'refunded', or declines → row removed). Cancelled tickets
-- drop out of the flat's QR pass immediately (allowed_scans shrinks on request and
-- is restored if the rep declines).
--
-- Vocabulary the dashboards use:
--   refund      = the AMOUNT (₹) paid back, counted once a request is 'refunded'
--   cancelled   = the COUNT of passes (persons) on any non-declined request, per flat
-- (`refund_state` enum from phase1_13 doubles as the request status here.)

-- ---------------------------------------------------------------------------
-- sadya_cancellations — one resident request to cancel N tickets for a refund.
-- Writes go through the SECURITY DEFINER functions below; clients read only.
-- ---------------------------------------------------------------------------
create table if not exists public.sadya_cancellations (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references public.events(id),
  flat_id              uuid references public.flats(id),
  resident_id          uuid not null references public.profiles(id),
  num_adults           int not null default 0 check (num_adults >= 0),
  num_children         int not null default 0 check (num_children >= 0),
  total_persons        int generated always as (num_adults + num_children) stored,
  adult_price_snapshot numeric(10,2) not null default 0,
  child_price_snapshot numeric(10,2) not null default 0,
  amount               numeric(10,2) not null default 0,
  paid_to_tower_id     uuid not null references public.towers(id),
  paid_to_rep_user_id  uuid references public.profiles(id),
  status               refund_state not null default 'requested',
  reason               text,
  requested_at         timestamptz not null default now(),
  refunded_at          timestamptz,
  refunded_by_user_id  uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  constraint sadya_cancellation_nonempty check (num_adults + num_children > 0)
);
create index if not exists sadya_canc_flat_event_idx on public.sadya_cancellations (flat_id, event_id);
create index if not exists sadya_canc_resident_idx   on public.sadya_cancellations (resident_id, event_id);
create index if not exists sadya_canc_tower_idx      on public.sadya_cancellations (paid_to_tower_id);

alter table public.sadya_cancellations enable row level security;

-- Resident sees own + their flat's; rep sees their tower's; admin sees all.
drop policy if exists sadya_canc_select on public.sadya_cancellations;
create policy sadya_canc_select on public.sadya_cancellations
  for select to authenticated using (
    public.is_admin()
    or resident_id = auth.uid()
    or flat_id = public.app_flat_id()
    or (public.app_role() = 'tower_rep' and paid_to_tower_id = public.app_tower_id())
  );
grant select on public.sadya_cancellations to authenticated;

-- ---------------------------------------------------------------------------
-- issue_flat_sadya_qr — a flat's QR = (verified persons) − (cancelled persons).
-- Cancelled = every cancellation row (requested OR refunded); a declined request
-- is deleted, so it stops subtracting. Replaces the phase2_02 definition.
-- ---------------------------------------------------------------------------
create or replace function public.issue_flat_sadya_qr(p_flat_id uuid, p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_verified  int;
  v_cancelled int;
  v_total     int;
begin
  if p_flat_id is null then return; end if;

  select coalesce(sum(total_persons), 0) into v_verified
    from public.sadya_bookings
   where flat_id = p_flat_id and event_id = p_event_id and status = 'verified';

  select coalesce(sum(total_persons), 0) into v_cancelled
    from public.sadya_cancellations
   where flat_id = p_flat_id and event_id = p_event_id;

  v_total := greatest(v_verified - v_cancelled, 0);

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
-- request_sadya_cancellation — a resident (or admin) cancels N tickets from
-- their VERIFIED bookings and asks for the money back. Caps each type at what's
-- still cancellable (booked − already-cancelled). Prices/rep come from the
-- resident's latest verified booking snapshot. Shrinks the flat QR right away.
-- ---------------------------------------------------------------------------
create or replace function public.request_sadya_cancellation(
  p_num_adults   int,
  p_num_children int,
  p_reason       text default null
) returns public.sadya_cancellations
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_prof     public.profiles;
  v_event    public.events;
  v_a        int := coalesce(p_num_adults, 0);
  v_c        int := coalesce(p_num_children, 0);
  v_booked_a int;
  v_booked_c int;
  v_canc_a   int;
  v_canc_c   int;
  v_src      public.sadya_bookings;
  v_amount   numeric(10,2);
  v_row      public.sadya_cancellations;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_prof from public.profiles where id = v_uid;
  if v_prof is null then raise exception 'Profile not found'; end if;

  select * into v_event from public.events where is_active limit 1;
  if v_event is null then raise exception 'No active event'; end if;

  if v_a < 0 or v_c < 0 then raise exception 'Counts cannot be negative'; end if;
  if v_a + v_c < 1 then raise exception 'Select at least one ticket to cancel'; end if;

  select coalesce(sum(num_adults), 0), coalesce(sum(num_children), 0)
    into v_booked_a, v_booked_c
    from public.sadya_bookings
   where resident_id = v_uid and event_id = v_event.id and status = 'verified';

  select coalesce(sum(num_adults), 0), coalesce(sum(num_children), 0)
    into v_canc_a, v_canc_c
    from public.sadya_cancellations
   where resident_id = v_uid and event_id = v_event.id;

  if v_a > v_booked_a - v_canc_a then
    raise exception 'You can cancel at most % more adult ticket(s)', v_booked_a - v_canc_a;
  end if;
  if v_c > v_booked_c - v_canc_c then
    raise exception 'You can cancel at most % more child ticket(s)', v_booked_c - v_canc_c;
  end if;

  -- Snapshot prices + receiving rep from the resident's most recent verified booking.
  select * into v_src
    from public.sadya_bookings
   where resident_id = v_uid and event_id = v_event.id and status = 'verified'
   order by created_at desc
   limit 1;
  if v_src is null then raise exception 'No verified bookings to cancel'; end if;

  v_amount := v_a * v_src.adult_price_snapshot + v_c * v_src.child_price_snapshot;

  insert into public.sadya_cancellations (
    event_id, flat_id, resident_id, num_adults, num_children,
    adult_price_snapshot, child_price_snapshot, amount,
    paid_to_tower_id, paid_to_rep_user_id, status, reason, requested_at
  ) values (
    v_event.id, v_prof.flat_id, v_uid, v_a, v_c,
    v_src.adult_price_snapshot, v_src.child_price_snapshot, v_amount,
    v_src.paid_to_tower_id, v_src.paid_to_rep_user_id, 'requested', nullif(btrim(p_reason), ''), now()
  )
  returning * into v_row;

  -- Tickets leave the flat's QR immediately.
  perform public.issue_flat_sadya_qr(v_prof.flat_id, v_event.id);

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after, reason)
    values (v_event.id, v_uid, 'sadya.cancellation_requested', 'sadya_cancellation', v_row.id,
            to_jsonb(v_row), nullif(btrim(p_reason), ''));

  return v_row;
end;
$$;
grant execute on function public.request_sadya_cancellation(int, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- process_sadya_cancellation — rep (own tower) or admin settles a request.
-- approve = paid the resident back → 'refunded' (tickets already off the QR).
-- decline = remove the request → tickets return to the flat's QR.
-- ---------------------------------------------------------------------------
create or replace function public.process_sadya_cancellation(
  p_cancellation_id uuid,
  p_approve         boolean,
  p_reason          text default null
) returns public.sadya_cancellations
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.sadya_cancellations;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_row from public.sadya_cancellations where id = p_cancellation_id;
  if v_row is null then raise exception 'Cancellation not found'; end if;
  if not (public.is_admin() or public.is_rep_of(v_row.paid_to_tower_id)) then
    raise exception 'Not authorized to process this cancellation';
  end if;
  if v_row.status is distinct from 'requested'::refund_state then
    raise exception 'This cancellation has already been settled';
  end if;

  if p_approve then
    update public.sadya_cancellations
       set status = 'refunded', refunded_at = now(), refunded_by_user_id = v_uid
     where id = p_cancellation_id
     returning * into v_row;
    -- Tickets already left the QR at request time; nothing to recompute.
  else
    delete from public.sadya_cancellations where id = p_cancellation_id;
    -- Declining returns the tickets to the flat's QR.
    perform public.issue_flat_sadya_qr(v_row.flat_id, v_row.event_id);
  end if;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after, reason)
    values (
      v_row.event_id, v_uid,
      case when p_approve then 'sadya.cancellation_refunded' else 'sadya.cancellation_declined' end,
      'sadya_cancellation', v_row.id, to_jsonb(v_row), nullif(btrim(p_reason), '')
    );

  return v_row;
end;
$$;
grant execute on function public.process_sadya_cancellation(uuid, boolean, text) to authenticated;
