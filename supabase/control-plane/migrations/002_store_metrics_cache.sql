-- =============================================================================
-- CONTROL_PLANE DATABASE — Store Metrics Cache Migration
-- =============================================================================
-- This migration applies to the CONTROL_PLANE Supabase project ONLY.
-- It is a SEPARATE database from any Store's database.
-- DO NOT run this against a Store's database.
-- =============================================================================
-- Requirements: 2.2 (per-store metrics display), 2.10 (unavailable metric marking),
--               9.2 (store at most cached aggregate numbers, never raw records)
-- =============================================================================

create table public.store_metrics_cache (
  store_id      uuid primary key references public.stores(id) on delete cascade,
  order_count   integer,
  revenue_total numeric(12,2),
  traffic_count bigint,
  quota_usage   jsonb not null default '{}',
  available     boolean not null default true,
  fetched_at    timestamptz
);

alter table public.store_metrics_cache enable row level security;
