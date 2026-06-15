-- =============================================================================
-- CONTROL_PLANE DATABASE — Notifications Migration
-- =============================================================================
-- This migration applies to the CONTROL_PLANE Supabase project ONLY.
-- It is a SEPARATE database from any Store's database.
-- DO NOT run this against a Store's database.
-- =============================================================================

-- Platform Notifications (Control_Plane authored messages)
create table public.platform_notifications (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,
  scope         text not null check (scope in ('single','set','broadcast')),
  mandatory     boolean not null default false,
  multichannel  boolean not null default false,
  content       text not null,
  created_by    uuid references public.platform_admins(user_id),
  created_at    timestamptz not null default now()
);

alter table public.platform_notifications enable row level security;

-- Notification targets — which stores a notification is addressed to
create table public.platform_notification_targets (
  notification_id uuid not null references public.platform_notifications(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  primary key (notification_id, store_id)
);

create index pnt_store_idx on public.platform_notification_targets (store_id);

alter table public.platform_notification_targets enable row level security;

-- Per-store read state
create table public.platform_notification_reads (
  notification_id uuid not null references public.platform_notifications(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, store_id)
);

alter table public.platform_notification_reads enable row level security;
