-- =============================================================================
-- CONTROL_PLANE DATABASE — Delivery & Preferences Migration
-- =============================================================================
-- This migration applies to the CONTROL_PLANE Supabase project ONLY.
-- It is a SEPARATE database from any Store's database.
-- DO NOT run this against a Store's database.
--
-- Feature: super-admin-platform
-- Requirements: 18.1, 18.2, 18.3, 18.4, 18.7, 18.9, 18.10
-- =============================================================================

-- Notification delivery attempts — records each channel attempt outcome (R18.4)
create table public.notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.platform_notifications(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  channel         text not null check (channel in ('in_app', 'email')),
  attempt_no      int not null default 1 check (attempt_no >= 1),
  outcome         text not null check (outcome in ('succeeded', 'failed')),
  error           text,
  attempted_at    timestamptz not null default now()
);

create index nd_notification_idx on public.notification_deliveries (notification_id);
create index nd_store_idx on public.notification_deliveries (store_id);

alter table public.notification_deliveries enable row level security;

-- Per-store, per-type, per-channel notification preferences (R18.3, R18.8)
create table public.notification_preferences (
  store_id  uuid not null references public.stores(id) on delete cascade,
  type      text not null,
  channel   text not null check (channel in ('in_app', 'email')),
  enabled   boolean not null default true,
  primary key (store_id, type, channel)
);

alter table public.notification_preferences enable row level security;
