-- Phase 1 · Migration 16 — Event schedule
-- A per-event schedule (image or PDF of the Onam programme) shown to residents
-- on their home page. Stored as a file in the existing public `event-assets`
-- bucket; admins set schedule_path via the normal events update RLS
-- (events_admin_update), so — like logo_path — no new RPC is needed.

alter table public.events add column if not exists schedule_path text;
