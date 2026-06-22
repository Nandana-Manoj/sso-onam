-- Phase 1 · Migration 04 — Event logo
-- A per-event logo shown across all consoles. Column on events + a public
-- storage bucket (admin-write only). Admins set logo_path via the normal
-- events update RLS (events_admin_update), so no new RPC is needed.

alter table public.events add column if not exists logo_path text;

insert into storage.buckets (id, name, public)
values ('event-assets', 'event-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "event assets public read"  on storage.objects;
drop policy if exists "event assets admin insert" on storage.objects;
drop policy if exists "event assets admin update" on storage.objects;

create policy "event assets public read" on storage.objects
  for select to public
  using (bucket_id = 'event-assets');

create policy "event assets admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-assets' and public.is_admin());

create policy "event assets admin update" on storage.objects
  for update to authenticated
  using  (bucket_id = 'event-assets' and public.is_admin())
  with check (bucket_id = 'event-assets' and public.is_admin());
