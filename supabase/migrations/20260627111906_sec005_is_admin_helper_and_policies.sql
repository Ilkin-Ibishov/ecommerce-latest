-- =============================================================
--  SEC-005 (P2) — Recursion-safe admin helper + in-scope policy rewrites
--  Finding: admin RLS policies subquery public.users inline. Live did NOT
--  reproduce 42P17 (GET /rest/v1/users -> 200 []), so this is MAINTAINABILITY
--  / fragility hardening, not a runtime-fault fix. Access decisions are
--  preserved byte-for-byte (admin-only reads/writes; service role bypasses RLS).
--
--  Live reconciliation (task 18.1, via pg_policies) — in-scope targets:
--    * audit_log."audit_admin_read"  (SELECT)
--    * pages."Pages: admin all"      (ALL)
--  NOTE: the design assumed a recursive policy "Admins: all users" ON
--  public.users. That policy does NOT exist live — public.users carries only
--  "users_own_read" (SELECT), which does not self-reference users. There is
--  therefore NO recursive policy on users to rewrite/drop.
--
--  EXPLICIT SCOPE: the ~13 cross-table admin policies that subquery users from
--  a DIFFERENT table (categories, category_translations, products,
--  product_translations, product_images, product_categories, coupons, orders,
--  order_items, comments, store_settings) are fragile-but-NOT-recursive and are
--  OUT of AC 2.5 scope. They are intentionally left untouched here (optional
--  consistency follow-up).
-- =============================================================

-- ─── Recursion-safe admin predicate ──────────────────────────
-- security definer + stable + fixed search_path. Resolves admin status without
-- a policy on users querying users. The function owner (postgres) bypasses RLS
-- inside the body, so it never recurses through the users RLS policies.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  )
$$;

-- Least-privilege execute grants. Revoke the implicit PUBLIC execute, then grant
-- only to the client roles that RLS evaluates policies under.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

-- ─── Rewrite IN-SCOPE policies to use public.is_admin() ──────
-- audit_log: admin-only read (live name: audit_admin_read). Same access
-- semantics — admins read, everyone else gets 0 rows.
drop policy if exists "audit_admin_read" on public.audit_log;
create policy "audit_admin_read" on public.audit_log
  for select
  using (public.is_admin());

-- pages: admin-only ALL (live name: "Pages: admin all"). Preserve the live
-- shape: a FOR ALL policy whose USING expression also gates writes (the public
-- read path remains "Pages: public read published", untouched).
drop policy if exists "Pages: admin all" on public.pages;
create policy "Pages: admin all" on public.pages
  for all
  using (public.is_admin());
