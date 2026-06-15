-- Migration 007: Store offboarding table
-- Feature: super-admin-platform
-- Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9

create table public.store_offboarding (
  store_id          uuid primary key references public.stores(id) on delete cascade,
  initiated_at      timestamptz not null default now(),
  retention_ends_at timestamptz not null,
  status_before     text not null,
  purged            boolean not null default false,
  purged_at         timestamptz,
  restored_at       timestamptz,
  teardown_recorded boolean not null default false,
  teardown_at       timestamptz
);
alter table public.store_offboarding enable row level security;
