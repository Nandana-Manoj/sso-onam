-- Phase 0 · Migration 03 — Row-Level Security
-- Helper functions (SECURITY DEFINER, read profiles without RLS recursion) +
-- default-deny RLS with per-role policies. Mutations to financial tables happen
-- only via SECURITY DEFINER functions (which run as the table owner, bypassing
-- RLS); clients therefore get SELECT policies only on those tables.

-- ---------------------------------------------------------------------------
-- Auth context helpers (named app_* to avoid the reserved word current_role)
-- ---------------------------------------------------------------------------
create or replace function public.app_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.app_tower_id()
returns uuid language sql stable security definer set search_path = public as $$
  select tower_id from public.profiles where id = auth.uid();
$$;

create or replace function public.app_flat_id()
returns uuid language sql stable security definer set search_path = public as $$
  select flat_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

grant execute on function public.app_role(), public.app_tower_id(),
  public.app_flat_id(), public.is_admin() to authenticated;

-- Public tower list (id/name/code only) for the pre-auth registration screen.
grant select on public.public_towers to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS (default-deny) on every table
-- ---------------------------------------------------------------------------
alter table public.towers              enable row level security;
alter table public.events              enable row level security;
alter table public.flats               enable row level security;
alter table public.profiles            enable row level security;
alter table public.correction_requests enable row level security;
alter table public.contributions       enable row level security;
alter table public.sadya_bookings      enable row level security;
alter table public.qr_passes           enable row level security;
alter table public.redemptions         enable row level security;
alter table public.fund_handovers      enable row level security;
alter table public.refund_requests     enable row level security;
alter table public.audit_log           enable row level security;

-- ---------------------------------------------------------------------------
-- towers
-- ---------------------------------------------------------------------------
create policy towers_select on public.towers
  for select to authenticated using (true);
create policy towers_admin_insert on public.towers
  for insert to authenticated with check (public.is_admin());
create policy towers_admin_update on public.towers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create policy events_select on public.events
  for select to authenticated using (true);
create policy events_admin_insert on public.events
  for insert to authenticated with check (public.is_admin());
create policy events_admin_update on public.events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- flats
-- ---------------------------------------------------------------------------
create policy flats_select on public.flats
  for select to authenticated using (
    public.is_admin()
    or tower_id = public.app_tower_id()
    or id = public.app_flat_id()
  );
create policy flats_write_rep_admin on public.flats
  for insert to authenticated with check (
    public.is_admin()
    or (public.app_role() = 'tower_rep' and tower_id = public.app_tower_id())
  );
create policy flats_update_rep_admin on public.flats
  for update to authenticated using (
    public.is_admin()
    or (public.app_role() = 'tower_rep' and tower_id = public.app_tower_id())
  ) with check (
    public.is_admin()
    or (public.app_role() = 'tower_rep' and tower_id = public.app_tower_id())
  );
-- (resident flat creation at registration goes through complete_registration())

-- ---------------------------------------------------------------------------
-- profiles  (identity-field changes guarded by trigger in migration 04)
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or public.is_admin()
    or (public.app_role() = 'tower_rep' and tower_id = public.app_tower_id())
  );
create policy profiles_update on public.profiles
  for update to authenticated using (
    id = auth.uid()
    or public.is_admin()
    or (public.app_role() = 'tower_rep' and tower_id = public.app_tower_id())
  ) with check (
    id = auth.uid()
    or public.is_admin()
    or (public.app_role() = 'tower_rep' and tower_id = public.app_tower_id())
  );
-- inserts happen via complete_registration() / create_proxy_resident(); no delete.

-- ---------------------------------------------------------------------------
-- correction_requests
-- ---------------------------------------------------------------------------
create policy corrections_select on public.correction_requests
  for select to authenticated using (
    public.is_admin()
    or profile_id = auth.uid()
    or (public.app_role() = 'tower_rep'
        and (requested_tower_id = public.app_tower_id() or current_tower_id = public.app_tower_id()))
  );
create policy corrections_insert_own on public.correction_requests
  for insert to authenticated with check (profile_id = auth.uid());
-- decisions happen via approve_correction() (later phase).

-- ---------------------------------------------------------------------------
-- contributions  (writes via RPC; clients read only)
-- ---------------------------------------------------------------------------
create policy contributions_select on public.contributions
  for select to authenticated using (
    public.is_admin()
    or flat_id = public.app_flat_id()                                   -- flat-shared visibility
    or (public.app_role() = 'tower_rep' and paid_to_tower_id = public.app_tower_id())
  );

-- ---------------------------------------------------------------------------
-- sadya_bookings  (writes via RPC; clients read only)
-- ---------------------------------------------------------------------------
create policy sadya_select on public.sadya_bookings
  for select to authenticated using (
    public.is_admin()
    or resident_id = auth.uid()
    or (public.app_role() = 'tower_rep' and paid_to_tower_id = public.app_tower_id())
  );

-- ---------------------------------------------------------------------------
-- qr_passes  (writes via RPC; clients read only)
-- ---------------------------------------------------------------------------
create policy qr_select on public.qr_passes
  for select to authenticated using (
    public.is_admin()
    or exists (
      select 1 from public.sadya_bookings b
      where b.id = qr_passes.booking_id
        and (b.resident_id = auth.uid()
             or (public.app_role() = 'tower_rep' and b.paid_to_tower_id = public.app_tower_id()))
    )
  );

-- ---------------------------------------------------------------------------
-- redemptions  (writes via RPC; clients read only)
-- ---------------------------------------------------------------------------
create policy redemptions_select on public.redemptions
  for select to authenticated using (
    public.is_admin()
    or exists (
      select 1 from public.qr_passes p
      join public.sadya_bookings b on b.id = p.booking_id
      where p.id = redemptions.qr_pass_id
        and (b.resident_id = auth.uid()
             or (public.app_role() = 'tower_rep' and b.paid_to_tower_id = public.app_tower_id()))
    )
  );

-- ---------------------------------------------------------------------------
-- fund_handovers  (writes via RPC; clients read only)
-- ---------------------------------------------------------------------------
create policy handovers_select on public.fund_handovers
  for select to authenticated using (
    public.is_admin()
    or (public.app_role() = 'tower_rep' and tower_id = public.app_tower_id())
  );

-- ---------------------------------------------------------------------------
-- refund_requests  (writes via RPC; clients read only)
-- ---------------------------------------------------------------------------
create policy refunds_select on public.refund_requests
  for select to authenticated using (
    public.is_admin() or resident_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- audit_log  (admin read; writes via SECURITY DEFINER functions only)
-- ---------------------------------------------------------------------------
create policy audit_admin_select on public.audit_log
  for select to authenticated using (public.is_admin());
