-- Phase 1 · Migration 14 — Correction request decisions (rep/admin approve/reject).
-- A resident files a tower/flat correction (see correction_requests). A tower rep
-- of the current OR requested tower, or an admin, can approve or reject it.
-- Approving moves the profile to the new tower/flat; the rep is NOT stored on the
-- profile — it's derived from towers.rep_user_id — so the move re-points the rep,
-- payment scope and the resident's "your rep" automatically.
--
-- The profile identity guard (migration 04) normally blocks tower/flat changes by
-- non-admins. We let this trusted, authorized RPC bypass it for the duration of
-- the transaction via a local GUC, rather than loosening the guard for everyone.

-- 1. Guard now also yields to the decision RPC's transaction-local flag.
create or replace function public.guard_profile_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin()
     and current_setting('app.allow_identity_change', true) is distinct from 'on' then
    if new.role     is distinct from old.role
       or new.tower_id is distinct from old.tower_id
       or new.flat_id  is distinct from old.flat_id then
      raise exception 'Changing role, tower, or flat requires admin/correction approval';
    end if;
  end if;
  return new;
end;
$$;

-- 2. List pending requests the caller may act on, with display-ready fields.
--    SECURITY DEFINER so a rep can see an *incoming* resident's name even though
--    that profile's current tower isn't theirs (profiles RLS would hide it).
create or replace function public.list_pending_corrections()
returns table (
  id              uuid,
  resident_name   text,
  resident_mobile text,
  current_tower   text,
  current_flat    text,
  requested_tower text,
  requested_flat  text,
  reason          text,
  created_at      timestamptz
) language sql security definer set search_path = public stable as $$
  select
    cr.id,
    p.name,
    p.mobile,
    ct.name,
    cf.flat_number,
    rt.name,
    coalesce(nullif(btrim(cr.requested_flat_number), ''), cf.flat_number),
    cr.reason,
    cr.created_at
  from public.correction_requests cr
  join public.profiles p on p.id = cr.profile_id
  left join public.towers ct on ct.id = cr.current_tower_id
  left join public.flats  cf on cf.id = cr.current_flat_id
  left join public.towers rt on rt.id = cr.requested_tower_id
  where cr.status = 'pending'
    and (public.is_admin()
         or public.is_rep_of(cr.current_tower_id)
         or public.is_rep_of(cr.requested_tower_id))
  order by cr.created_at;
$$;
grant execute on function public.list_pending_corrections() to authenticated;

-- 3. Approve or reject a pending request.
create or replace function public.decide_correction(
  p_request_id uuid,
  p_approve    boolean,
  p_reason     text default null
) returns public.correction_requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_req     public.correction_requests;
  v_tower   uuid;
  v_flatnum text;
  v_flat_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_req from public.correction_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'This request has already been decided'; end if;

  if not (public.is_admin()
          or public.is_rep_of(v_req.current_tower_id)
          or public.is_rep_of(v_req.requested_tower_id)) then
    raise exception 'Not allowed to decide this request';
  end if;

  if p_approve then
    v_tower   := coalesce(v_req.requested_tower_id, v_req.current_tower_id);
    v_flatnum := upper(nullif(btrim(v_req.requested_flat_number), ''));
    if v_flatnum is null then
      select flat_number into v_flatnum from public.flats where id = v_req.current_flat_id;
    end if;
    if v_tower is null or v_flatnum is null then
      raise exception 'Request is missing a target tower/flat';
    end if;

    select id into v_flat_id from public.flats
      where tower_id = v_tower and flat_number = v_flatnum;
    if v_flat_id is null then
      insert into public.flats (tower_id, flat_number) values (v_tower, v_flatnum)
        returning id into v_flat_id;
    end if;

    -- Trusted, authorized move: bypass the identity guard for this transaction.
    perform set_config('app.allow_identity_change', 'on', true);
    update public.profiles
       set tower_id = v_tower, flat_id = v_flat_id, updated_at = now()
     where id = v_req.profile_id;
    perform set_config('app.allow_identity_change', 'off', true);
  end if;

  update public.correction_requests
     set status             = (case when p_approve then 'approved' else 'rejected' end)::request_status,
         decided_by_user_id = v_uid,
         decided_at         = now()
   where id = p_request_id
   returning * into v_req;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, after, reason)
    values (v_uid,
            case when p_approve then 'correction.approved' else 'correction.rejected' end,
            'correction_request', p_request_id, to_jsonb(v_req), nullif(btrim(p_reason), ''));

  return v_req;
end;
$$;
grant execute on function public.decide_correction(uuid, boolean, text) to authenticated;
