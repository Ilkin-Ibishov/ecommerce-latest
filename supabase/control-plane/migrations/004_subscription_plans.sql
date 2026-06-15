-- Migration 004: Subscription Plans table
-- Feature: super-admin-platform
-- Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.13, 13.14

create table public.subscription_plans (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  name_normalized   text not null,
  price             numeric(12,2) not null check (price >= 0 and price <= 999999999.99),
  billing_interval  text not null check (billing_interval in ('monthly','yearly')),
  feature_flags     jsonb not null default '{}',
  quota_limits      jsonb not null default '{}',
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index plans_name_norm_uniq on public.subscription_plans (name_normalized);

create trigger trg_plans_updated_at before update on public.subscription_plans
  for each row execute function set_updated_at();

alter table public.subscription_plans enable row level security;
