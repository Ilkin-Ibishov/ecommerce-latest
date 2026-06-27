-- =============================================================================
-- CONTROL_PLANE DATABASE — Deny-by-default Assertion Migration
-- =============================================================================
-- This migration applies to the CONTROL_PLANE Supabase project ONLY.
-- It is a SEPARATE database from any Store's database.
-- DO NOT run this against a Store's database.
--
-- Feature: supabase-rls-security-fixes (SEC-007, task 20.2)
-- Requirements: 2.7 (control-plane deny-by-default), 2.10 (ships as a migration)
-- Design: Property 7 — control-plane tables SHALL be asserted deny-by-default
--         (RLS enabled, zero policies) via a migration/test.
--
-- This migration is SELF-ASSERTING and IDEMPOTENT: it creates no objects and
-- changes no state. It FAILS CLOSED — raising an exception (aborting the apply)
-- if EITHER invariant is violated:
--   1. Any table in the `public` schema has Row Level Security DISABLED.
--   2. Any RLS policy EXISTS on the `public` schema.
-- Deny-by-default = RLS enabled on every table + zero policies, so the anon key
-- (shipped historically to the browser) can read/write nothing.
-- =============================================================================

do $$
declare
  bad int;
begin
  -- Invariant 1: every public control-plane table must have RLS ENABLED.
  -- A base table (relkind = 'r') counts as "bad" when RLS is DISABLED on it,
  -- i.e. `not c.relrowsecurity`.
  select count(*) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;
  if bad > 0 then
    raise exception 'control-plane deny-by-default violated: % public table(s) without RLS enabled', bad;
  end if;

  -- Invariant 2: deny-by-default means ZERO policies on the public schema.
  -- Any policy present is a potential exposure surface and fails the assertion.
  select count(*) into bad
  from pg_policies
  where schemaname = 'public';
  if bad > 0 then
    raise exception 'control-plane deny-by-default violated: % unexpected policy(ies) on public schema', bad;
  end if;
end $$;
