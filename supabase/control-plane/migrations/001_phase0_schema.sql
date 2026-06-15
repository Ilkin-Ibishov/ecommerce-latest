-- =============================================================================
-- CONTROL_PLANE DATABASE — Phase 0 Schema Migration
-- =============================================================================
-- This migration applies to the CONTROL_PLANE Supabase project ONLY.
-- It is a SEPARATE database from any Store's database.
-- DO NOT run this against a Store's database.
-- =============================================================================

-- ─── Trigger function: auto-manage updated_at ──────────────────────────────
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ─── Store Registry ─────────────────────────────────────────────────────────
-- Platform_Status FSM: onboarding → active → suspended → disabled
-- Subscription_Status: trialing, active, past_due, cancelled
create table public.stores (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  name_normalized           text not null,
  instance_url              text not null,
  metrics_endpoint_url      text not null,
  per_store_credential_hash text not null,
  owner_email               text not null,
  owner_name                text,
  locale                    text not null default 'az'
                              check (locale in ('az', 'ru', 'en')),
  platform_status           text not null default 'onboarding'
                              check (platform_status in ('onboarding', 'active', 'suspended', 'disabled')),
  subscription_status       text not null default 'trialing'
                              check (subscription_status in ('trialing', 'active', 'past_due', 'cancelled')),
  suspended_at              timestamptz,
  status_before_suspend     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Case-insensitive unique name constraint
create unique index stores_name_norm_uniq on public.stores (name_normalized);

-- Trigger-managed updated_at
create trigger trg_stores_updated_at
  before update on public.stores
  for each row execute function set_updated_at();

-- Enable RLS
alter table public.stores enable row level security;

-- ─── Platform Admins ────────────────────────────────────────────────────────
-- Super_Admin tier marker (R1)
create table public.platform_admins (
  user_id     uuid primary key,
  mfa_enabled boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Enable RLS
alter table public.platform_admins enable row level security;

-- ─── Control Plane Sessions ─────────────────────────────────────────────────
-- R17: lifetime (8h) and idle (15m) enforcement
create table public.control_plane_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.platform_admins(user_id) on delete cascade,
  mfa_verified boolean not null default false,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at     timestamptz,
  end_reason   text
);

-- Enable RLS
alter table public.control_plane_sessions enable row level security;

-- ─── Control Plane Audit Log ────────────────────────────────────────────────
-- Platform audit trail (R11). Reuses the writeAudit() shape with scope marker.
create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  changes    jsonb not null default '{}',
  scope      text not null default 'platform'
               check (scope in ('platform')),
  store_id   uuid references public.stores(id),
  created_at timestamptz not null default now()
);

-- Indexes for efficient audit queries
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_store_idx on public.audit_log (store_id, created_at desc);

-- Enable RLS
alter table public.audit_log enable row level security;
