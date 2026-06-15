-- Migration 006: Impersonation sessions table
-- Feature: super-admin-platform
-- Requirements: 10.1, 10.2, 10.5, 10.6

create table public.impersonation_sessions (
  id              uuid primary key default gen_random_uuid(),
  super_admin_id  uuid not null references public.platform_admins(user_id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  ended_at        timestamptz,
  end_reason      text check (end_reason in ('manual', 'expired'))
);
alter table public.impersonation_sessions enable row level security;
