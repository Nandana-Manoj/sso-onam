-- Phase 3 · Migration 03 — suggestion box for tower reps & admins.
-- A lightweight feedback channel so reps/admins can send free-text suggestions
-- to help improve the app. This is intentionally NOT surfaced in-app to anyone
-- (not even other admins) — only the developer reads it, via the Supabase
-- dashboard (service_role bypasses RLS) or a future Google Sheet sync. No
-- SELECT policy/grant is created on purpose.

-- app_name(): current user's display name — mirrors the existing app_role() /
-- app_tower_id() / app_flat_id() family, so it can be snapshotted server-side
-- (not trusted from the client) the same way role already is below.
create or replace function public.app_name()
returns text language sql stable security definer set search_path = public as $$
  select name from public.profiles where id = auth.uid();
$$;
grant execute on function public.app_name() to authenticated;

create table public.suggestions (
  id                    uuid primary key default gen_random_uuid(),
  submitted_by_user_id  uuid not null default auth.uid() references public.profiles(id),
  submitted_by_name     text not null default public.app_name(),
  role                  user_role not null default public.app_role(),
  message               text not null check (btrim(message) <> ''),
  created_at            timestamptz not null default now()
);
create index suggestions_created_idx on public.suggestions (created_at desc);

alter table public.suggestions enable row level security;

-- Only tower reps and admins may submit, and only as themselves. Every
-- identifying column defaults off a server-derived helper, and the with-check
-- also pins each one so a client can't override any of them explicitly.
create policy suggestions_insert on public.suggestions for insert to authenticated
with check (
  submitted_by_user_id = auth.uid()
  and submitted_by_name = public.app_name()
  and role = public.app_role()
  and public.app_role() in ('tower_rep', 'admin')
);
grant insert on public.suggestions to authenticated;
