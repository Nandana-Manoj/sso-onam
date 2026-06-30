-- Phase 3 · Migration 01 — Sadya serving gate + QR redemption.
-- Event day: a sadya rep scans a flat's single QR pass and redeems meals against
-- it. Passes are PARTIAL / MULTI-SCAN — the rep scans once, enters a head-count,
-- and the same pass can be scanned again later for flatmates who arrive afterward
-- (redeemed_count accumulates toward allowed_scans: issued -> partially_redeemed
-- -> fully_redeemed). Redemption is gated by an admin "serving open" toggle and
-- restricted to sadya reps (is_sadya_rep(), incl. admins). The redemptions table +
-- SELECT RLS already exist from phase0/phase2; this adds the only writer.

-- ---------------------------------------------------------------------------
-- Serving gate (mirrors sadya_open / set_sadya_open from phase2_01)
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists sadya_serving_open boolean not null default false;

create or replace function public.set_sadya_serving_open(p_event_id uuid, p_open boolean)
returns public.events
language plpgsql security definer set search_path = public as $$
declare v_event public.events;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;

  update public.events set sadya_serving_open = coalesce(p_open, false)
   where id = p_event_id
   returning * into v_event;
  if v_event is null then raise exception 'Event not found'; end if;

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after)
    values (p_event_id, auth.uid(),
            case when p_open then 'event.sadya_serving_opened' else 'event.sadya_serving_closed' end,
            'event', p_event_id, to_jsonb(v_event));

  return v_event;
end;
$$;
grant execute on function public.set_sadya_serving_open(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotency key for the offline scan queue: a device mints a client_scan_id
-- per scan and may replay it on sync; the unique key lets redeem_sadya_pass
-- return the prior outcome instead of double-counting.
-- ---------------------------------------------------------------------------
alter table public.redemptions
  add column if not exists client_scan_id uuid;
create unique index if not exists redemptions_client_scan_idx
  on public.redemptions (client_scan_id) where client_scan_id is not null;

-- ---------------------------------------------------------------------------
-- lookup_sadya_pass — read-only preview for the scanner (no write). Lets the rep
-- confirm the flat + remaining count before committing a redemption. Returns
-- found=false (as data, not an error) for an unknown nonce so the UI can show
-- "invalid pass". serving_open is surfaced so the UI can warn up front.
-- ---------------------------------------------------------------------------
create or replace function public.lookup_sadya_pass(p_nonce text)
returns table (
  found          boolean,
  flat_id        uuid,
  tower_name     text,
  flat_number    text,
  allowed_scans  int,
  redeemed_count int,
  remaining      int,
  status         text,
  serving_open   boolean
) language plpgsql security definer set search_path = public as $$
declare v_pass public.qr_passes;
begin
  if not public.is_sadya_rep() then raise exception 'Not authorized to scan sadya passes'; end if;

  select * into v_pass from public.qr_passes where nonce = p_nonce;
  if v_pass.id is null then
    return query select false, null::uuid, null::text, null::text,
                        null::int, null::int, null::int, null::text, null::boolean;
    return;
  end if;

  return query
    select true, v_pass.flat_id, t.name, f.flat_number,
           v_pass.allowed_scans, v_pass.redeemed_count,
           v_pass.allowed_scans - v_pass.redeemed_count,
           v_pass.status::text, e.sadya_serving_open
      from public.flats f
      join public.towers t on t.id = f.tower_id
      join public.events e on e.id = v_pass.event_id
     where f.id = v_pass.flat_id;
end;
$$;
grant execute on function public.lookup_sadya_pass(text) to authenticated;

-- ---------------------------------------------------------------------------
-- redeem_sadya_pass — the writer. Locks the flat's pass, applies a head-count,
-- logs every attempt to redemptions (accepted + rejected, for audit), and bumps
-- redeemed_count / recomputes status only on accept. redemptions has no INSERT
-- policy, so this security-definer function is the only writer.
--   not found  -> rejected_invalid (no row: qr_pass_id is NOT NULL)
--   void pass  -> rejected_void
--   over cap   -> rejected_exhausted (returns remaining so the rep can retry less)
--   otherwise  -> accepted (redeemed_count += count)
-- ---------------------------------------------------------------------------
create or replace function public.redeem_sadya_pass(
  p_nonce          text,
  p_count          int  default 1,
  p_device         text default null,
  p_client_scan_id uuid default null
) returns table (
  result         text,
  tower_name     text,
  flat_number    text,
  allowed_scans  int,
  redeemed_count int,
  remaining      int
) language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_count     int  := greatest(coalesce(p_count, 1), 1);
  v_pass      public.qr_passes;
  v_existing  public.redemptions;
  v_result    redeem_result;
  v_new_count int;
  v_new_status qr_status;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_sadya_rep() then raise exception 'Not authorized to scan sadya passes'; end if;

  -- Idempotent replay from the offline queue: same client_scan_id -> prior outcome.
  if p_client_scan_id is not null then
    select * into v_existing from public.redemptions where client_scan_id = p_client_scan_id;
    if v_existing.id is not null then
      select * into v_pass from public.qr_passes where id = v_existing.qr_pass_id;
      return query
        select v_existing.result::text, t.name, f.flat_number,
               v_pass.allowed_scans, v_pass.redeemed_count,
               v_pass.allowed_scans - v_pass.redeemed_count
          from public.flats f join public.towers t on t.id = f.tower_id
         where f.id = v_pass.flat_id;
      return;
    end if;
  end if;

  -- Find + lock the pass (serializes concurrent counters on the same flat).
  select * into v_pass from public.qr_passes where nonce = p_nonce for update;

  if v_pass.id is null then
    return query select 'rejected_invalid'::text, null::text, null::text,
                        null::int, null::int, null::int;
    return;
  end if;

  -- Serving gate (checked server-side, incl. at offline-sync time).
  if not exists (select 1 from public.events e where e.id = v_pass.event_id and e.sadya_serving_open) then
    raise exception 'Sadya serving is not open';
  end if;

  if v_pass.status = 'void' then
    v_result := 'rejected_void';
  elsif v_pass.redeemed_count + v_count > v_pass.allowed_scans then
    v_result := 'rejected_exhausted';
  else
    v_result := 'accepted';
    -- Compute into locals first: the function's RETURNS TABLE output names
    -- (redeemed_count, allowed_scans) collide with the qr_passes columns, so a
    -- bare column reference inside the UPDATE would be ambiguous.
    v_new_count  := v_pass.redeemed_count + v_count;
    v_new_status := (case when v_new_count >= v_pass.allowed_scans
                          then 'fully_redeemed' else 'partially_redeemed' end)::qr_status;
    update public.qr_passes
       set redeemed_count = v_new_count,
           status         = v_new_status
     where id = v_pass.id
     returning * into v_pass;
  end if;

  insert into public.redemptions
    (qr_pass_id, event_id, scanned_by_user_id, count_redeemed, result, device_info, client_scan_id)
    values (v_pass.id, v_pass.event_id, v_uid, v_count, v_result, p_device, p_client_scan_id);

  insert into public.audit_log (event_id, actor_user_id, action, entity_type, entity_id, after)
    values (v_pass.event_id, v_uid, 'sadya.redeemed', 'qr_pass', v_pass.id,
            jsonb_build_object('result', v_result, 'count', v_count,
                               'redeemed_count', v_pass.redeemed_count,
                               'allowed_scans', v_pass.allowed_scans));

  return query
    select v_result::text, t.name, f.flat_number,
           v_pass.allowed_scans, v_pass.redeemed_count,
           v_pass.allowed_scans - v_pass.redeemed_count
      from public.flats f join public.towers t on t.id = f.tower_id
     where f.id = v_pass.flat_id;
end;
$$;
grant execute on function public.redeem_sadya_pass(text, int, text, uuid) to authenticated;
