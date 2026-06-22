-- Phase 0 · Migration 02 — Transactional tables + audit
-- contributions, sadya_bookings, qr_passes, redemptions, fund_handovers,
-- refund_requests (placeholder), audit_log + constraints + indexes.
-- Payment fields are embedded on contributions/sadya_bookings per the design.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type txn_status        as enum ('payment_pending', 'submitted', 'verified', 'rejected', 'expired');
create type txn_status_sadya  as enum ('payment_pending', 'submitted', 'verified', 'rejected', 'expired', 'cancelled');
create type qr_status         as enum ('issued', 'partially_redeemed', 'fully_redeemed', 'void');
create type redeem_result     as enum ('accepted', 'rejected_exhausted', 'rejected_void', 'rejected_invalid');
create type handover_status   as enum ('logged', 'confirmed', 'rejected');
create type refund_reason     as enum ('overpayment', 'cancellation');
create type refund_status     as enum ('pending');

-- ---------------------------------------------------------------------------
-- contributions — one LIVE row per flat per event (partial-unique guard).
-- ---------------------------------------------------------------------------
create table public.contributions (
  id                     uuid primary key default gen_random_uuid(),
  event_id               uuid not null references public.events(id) on delete restrict,
  flat_id                uuid not null references public.flats(id) on delete restrict,
  initiated_by_user_id   uuid not null references public.profiles(id),
  amount                 numeric(10,2) not null,
  min_snapshot           numeric(10,2) not null,
  status                 txn_status not null default 'payment_pending',
  -- embedded payment
  paid_to_tower_id       uuid not null references public.towers(id),
  amount_paid            numeric(10,2),
  utr                    text,
  screenshot_path        text,
  payment_submitted_at   timestamptz,
  verified_by_user_id    uuid references public.profiles(id),
  verified_at            timestamptz,
  decision_reason        text,
  overridden             boolean not null default false,
  overridden_by_user_id  uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint contributions_amount_min check (amount >= min_snapshot)
);
-- "Once per flat per event": only one non-terminal/verified contribution may exist.
create unique index contributions_one_active_idx
  on public.contributions (flat_id, event_id)
  where status in ('payment_pending', 'submitted', 'verified');
create index contributions_event_status_idx on public.contributions (event_id, status);
create index contributions_tower_status_idx on public.contributions (paid_to_tower_id, status);
create index contributions_flat_idx         on public.contributions (flat_id);

-- ---------------------------------------------------------------------------
-- sadya_bookings — per person; multiple bookings per resident allowed.
-- ---------------------------------------------------------------------------
create table public.sadya_bookings (
  id                     uuid primary key default gen_random_uuid(),
  event_id               uuid not null references public.events(id) on delete restrict,
  resident_id            uuid not null references public.profiles(id),
  flat_id                uuid references public.flats(id),
  num_adults             int not null default 0 check (num_adults  >= 0),
  num_children           int not null default 0 check (num_children >= 0),
  total_persons          int generated always as (num_adults + num_children) stored,
  adult_price_snapshot   numeric(10,2) not null,
  child_price_snapshot   numeric(10,2) not null,
  total_amount           numeric(10,2) not null,
  status                 txn_status_sadya not null default 'payment_pending',
  -- embedded payment
  paid_to_tower_id       uuid not null references public.towers(id),
  amount_paid            numeric(10,2),
  utr                    text,
  screenshot_path        text,
  payment_submitted_at   timestamptz,
  verified_by_user_id    uuid references public.profiles(id),
  verified_at            timestamptz,
  decision_reason        text,
  overridden             boolean not null default false,
  overridden_by_user_id  uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint sadya_min_one_person check ((num_adults + num_children) >= 1)
);
create index sadya_resident_idx     on public.sadya_bookings (resident_id);
create index sadya_event_status_idx on public.sadya_bookings (event_id, status);
create index sadya_tower_status_idx on public.sadya_bookings (paid_to_tower_id, status);
create index sadya_flat_idx         on public.sadya_bookings (flat_id);

-- ---------------------------------------------------------------------------
-- qr_passes — one per verified booking; redeemable exactly allowed_scans times.
-- ---------------------------------------------------------------------------
create table public.qr_passes (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null unique references public.sadya_bookings(id) on delete restrict,
  event_id            uuid not null references public.events(id),
  allowed_scans       int  not null check (allowed_scans >= 1),
  nonce               text not null unique,
  redeemed_count      int  not null default 0,
  status              qr_status not null default 'issued',
  voided_at           timestamptz,
  voided_by_user_id   uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  constraint qr_redeem_bounds check (redeemed_count >= 0 and redeemed_count <= allowed_scans)
);
create index qr_event_status_idx on public.qr_passes (event_id, status);

-- ---------------------------------------------------------------------------
-- redemptions — one immutable row per scan action.
-- ---------------------------------------------------------------------------
create table public.redemptions (
  id                  uuid primary key default gen_random_uuid(),
  qr_pass_id          uuid not null references public.qr_passes(id) on delete restrict,
  event_id            uuid not null references public.events(id),
  scanned_by_user_id  uuid not null references public.profiles(id),
  scanned_at          timestamptz not null default now(),
  count_redeemed      int not null default 1 check (count_redeemed >= 1),
  result              redeem_result not null,
  device_info         text
);
create index redemptions_pass_idx       on public.redemptions (qr_pass_id);
create index redemptions_event_time_idx on public.redemptions (event_id, scanned_at);

-- ---------------------------------------------------------------------------
-- fund_handovers — rep -> committee transfer log (balance derived in views).
-- ---------------------------------------------------------------------------
create table public.fund_handovers (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references public.events(id),
  tower_id              uuid not null references public.towers(id),
  rep_user_id           uuid not null references public.profiles(id),
  amount                numeric(10,2) not null check (amount > 0),
  handover_date         date not null default current_date,
  received_by_user_id   uuid references public.profiles(id),
  received_by_name      text,
  reference             text,
  note                  text,
  status                handover_status not null default 'logged',
  confirmed_by_user_id  uuid references public.profiles(id),
  confirmed_at          timestamptz,
  created_at            timestamptz not null default now()
);
create index handovers_tower_event_idx on public.fund_handovers (tower_id, event_id, status);

-- ---------------------------------------------------------------------------
-- refund_requests — PLACEHOLDER (capture overpay/cancel; logic deferred).
-- ---------------------------------------------------------------------------
create table public.refund_requests (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id),
  resident_id      uuid not null references public.profiles(id),
  contribution_id  uuid references public.contributions(id),
  booking_id       uuid references public.sadya_bookings(id),
  amount           numeric(10,2) not null check (amount > 0),
  reason           refund_reason not null,
  status           refund_status not null default 'pending',
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit_log — append-only system journal (written only by SECURITY DEFINER fns).
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id              bigint generated always as identity primary key,
  event_id        uuid references public.events(id),
  actor_user_id   uuid references public.profiles(id),
  action          text not null,
  entity_type     text,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  reason          text,
  created_at      timestamptz not null default now()
);
create index audit_entity_idx     on public.audit_log (entity_type, entity_id);
create index audit_event_time_idx on public.audit_log (event_id, created_at);
create index audit_actor_idx      on public.audit_log (actor_user_id);
