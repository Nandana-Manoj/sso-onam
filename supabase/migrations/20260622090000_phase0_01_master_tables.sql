-- Phase 0 · Migration 01 — Master / configuration tables
-- Enums, towers, events, flats, profiles, correction_requests + constraints + indexes.
-- No RLS or functions here (see later migrations).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type user_role as enum ('resident', 'tower_rep', 'admin', 'sponsorship');
create type request_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- towers — organizational unit; holds the CURRENT rep + their payment QR.
-- Historical attribution of who verified lives on payment rows + audit_log.
-- ---------------------------------------------------------------------------
create table public.towers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  code             text unique,
  rep_user_id      uuid,                       -- FK to profiles added after profiles exists
  rep_contact      text,
  payment_qr_path  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- events — the annual edition + configuration (snapshotted onto records).
-- ---------------------------------------------------------------------------
create table public.events (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  year                   int  not null,
  is_active              boolean not null default false,
  min_contribution       numeric(10,2) not null check (min_contribution >= 0),
  adult_sadya_price      numeric(10,2) not null check (adult_sadya_price >= 0),
  child_sadya_price      numeric(10,2) not null default 0 check (child_sadya_price >= 0),
  booking_freeze_at      timestamptz,
  verification_cutoff_at timestamptz,
  currency               text not null default 'INR',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
-- At most one active event at a time.
create unique index events_one_active_idx on public.events (is_active) where is_active;

-- ---------------------------------------------------------------------------
-- flats — the contribution-bearing unit / family grouping.
-- A flat row belongs to exactly one tower (unique tower_id + flat_number).
-- ---------------------------------------------------------------------------
create table public.flats (
  id           uuid primary key default gen_random_uuid(),
  tower_id     uuid not null references public.towers(id) on delete restrict,
  flat_number  text not null,           -- store canonical normalized form
  created_at   timestamptz not null default now(),
  unique (tower_id, flat_number)
);
create index flats_tower_idx on public.flats (tower_id);

-- ---------------------------------------------------------------------------
-- profiles — the User (1:1 with auth.users). Identity/password/phone live in
-- auth.users; this holds the domain attributes used by RLS.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  name                 text not null,
  mobile               text not null unique,
  role                 user_role not null default 'resident',
  tower_id             uuid references public.towers(id) on delete set null,
  flat_id              uuid references public.flats(id) on delete set null,
  claimed              boolean not null default true,    -- false for proxy accounts until first login
  created_by_user_id   uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index profiles_tower_idx on public.profiles (tower_id);
create index profiles_flat_idx  on public.profiles (flat_id);
create index profiles_role_idx  on public.profiles (role);

-- Deferred FK: towers.rep_user_id -> profiles.id
alter table public.towers
  add constraint towers_rep_user_fk
  foreign key (rep_user_id) references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- correction_requests — Tower/Flat change approvals (rep intra-tower / admin).
-- ---------------------------------------------------------------------------
create table public.correction_requests (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null references public.profiles(id) on delete cascade,
  current_tower_id       uuid references public.towers(id),
  current_flat_id        uuid references public.flats(id),
  requested_tower_id     uuid references public.towers(id),
  requested_flat_number  text,
  status                 request_status not null default 'pending',
  requested_by_user_id   uuid references public.profiles(id),
  decided_by_user_id     uuid references public.profiles(id),
  decided_at             timestamptz,
  reason                 text,
  created_at             timestamptz not null default now()
);
-- At most one pending correction per resident.
create unique index correction_one_pending_idx
  on public.correction_requests (profile_id) where status = 'pending';
create index correction_requested_tower_idx
  on public.correction_requests (requested_tower_id, status);

-- Public, non-sensitive tower list for the pre-auth registration screen
-- (exposes only id/name/code; rep contact + QR stay behind auth).
create view public.public_towers as
  select id, name, code from public.towers;
