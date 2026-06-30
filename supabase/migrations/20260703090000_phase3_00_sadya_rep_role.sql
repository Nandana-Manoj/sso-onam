-- Phase 3 · Migration 00 — "Sadya rep" capability.
-- A sadya rep is a resident who is additionally allowed to scan/redeem flat sadya
-- QR passes at the serving counter on event day. profiles.role is single-valued
-- (resident | tower_rep | admin | sponsorship), so this is modelled as a grantable
-- FLAG that stacks on top of the existing role rather than a new role value — a
-- sadya rep stays a resident (and can still be a tower_rep) and books their own
-- flat's sadya as usual. Admins implicitly have the capability.

-- ---------------------------------------------------------------------------
-- Flag + helper
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_sadya_rep boolean not null default false;

create or replace function public.is_sadya_rep()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_sadya_rep from public.profiles where id = auth.uid()), false)
         or public.is_admin();
$$;
grant execute on function public.is_sadya_rep() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin grant/revoke. Independent of role — granting does not change role, so a
-- resident stays a resident and a tower_rep stays a tower_rep.
-- ---------------------------------------------------------------------------
create or replace function public.grant_sadya_rep(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found';
  end if;

  update public.profiles set is_sadya_rep = true where id = p_user_id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id)
    values (auth.uid(), 'sadya_rep.granted', 'profile', p_user_id);
end;
$$;
grant execute on function public.grant_sadya_rep(uuid) to authenticated;

create or replace function public.revoke_sadya_rep(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;

  update public.profiles set is_sadya_rep = false where id = p_user_id and is_sadya_rep;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id)
    values (auth.uid(), 'sadya_rep.revoked', 'profile', p_user_id);
end;
$$;
grant execute on function public.revoke_sadya_rep(uuid) to authenticated;
