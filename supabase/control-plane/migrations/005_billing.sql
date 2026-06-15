-- Migration 005: Billing tables (invoices, grace_periods, billing_config)
-- Feature: super-admin-platform
-- Requirements: 14.1, 14.11, 6.10

create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  plan_id       uuid not null references public.subscription_plans(id),
  period_start  date not null,
  period_end    date not null,
  issue_date    date not null,
  due_date      date not null,
  amount        numeric(12,2) not null,
  status        text not null default 'open' check (status in ('open','paid','void')),
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (store_id, period_start, period_end)
);
alter table public.invoices enable row level security;

create table public.grace_periods (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  invoice_id    uuid not null references public.invoices(id) on delete cascade,
  started_at    timestamptz not null,
  ends_at       timestamptz not null,
  resolved      boolean not null default false
);
alter table public.grace_periods enable row level security;

create table public.billing_config (
  id                int primary key default 1 check (id = 1),
  trial_days        int not null default 14 check (trial_days between 0 and 365),
  due_days          int not null default 14 check (due_days between 1 and 90),
  grace_period_days int not null default 7 check (grace_period_days between 0 and 365),
  currency          text not null default 'AZN'
);
alter table public.billing_config enable row level security;
insert into public.billing_config (id) values (1);
