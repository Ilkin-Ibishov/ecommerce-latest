# Test Supabase project bootstrap — notes

2026-11-06. Addresses `docs/STATUS.md` open item 5: a dedicated test Supabase project now
exists and carries the full schema. This is the first time any migration in this repository
has run against a real Postgres.

## Project

- Name: `ecommerce-warehouse`, ref `jcvsnoiacrknzejouxah`, region `ap-south-1`, Postgres 17.
- URL: `https://jcvsnoiacrknzejouxah.supabase.co`
- Owner: Ilkin Ibishov's personal Supabase org (only org available).

## What this uncovered: schema.sql and supabase/migrations/ are each independently incomplete

`supabase/migrations/*.sql` cannot bootstrap a fresh database: the earliest migrations
(`20260605114453_add_admin_notes_to_orders.sql`, etc.) are `ALTER TABLE` statements against
`orders`/`users`/`products`, but no migration file ever `CREATE TABLE`s those — they only ever
existed as the hand-run `supabase/schema.sql` script, executed directly in the Supabase SQL
Editor outside migration history.

`schema.sql` is itself not self-contained either: it already incorporates the full end-state of
M1/M2a/M2b/M2c (confirmed — `reservations_view` already carries the `security_invoker = true`
fix from migration `20261105200000`), but it references `public.site_settings` and
`public.products.brand` without ever creating them, and never creates `store_settings`, `pages`,
`page_translations`, `size_guides`, `brand_entries`, `order_status_history`, or the
`site-assets` storage bucket — all of which exist only in `supabase/migrations/`.

**`products.brand` was referenced by `20260613123817_add_search_text_column.sql`
(`NEW.brand`/`p.brand`) but never created by any tracked file.** It must have been added by
hand against a real project outside migration history — the same class of drift item 5 was
written to catch, one layer deeper than file ordering. Fixed by a new migration,
`supabase/migrations/20261105210000_add_product_brand_column.sql`, and mirrored into
`schema.sql`'s `products` table definition.

## Bootstrap order used (not a literal replay of migration history — see above)

1. `site_settings` base (table, constraint, seed row, RLS, public-read policy — *without* its
   `updated_at` trigger, which needs `set_updated_at()` from step 2)
2. `schema.sql` in full (creates `set_updated_at()`, and ALTERs `site_settings` —
   requires step 1 first)
3. `site_settings`'s deferred `trg_site_settings_updated_at` trigger
4. `store_settings`
5. `site-assets` storage bucket + policies
6. `pages`
7. `page_translations`
8. `size_guides`
9. `brand_entries`
10. `order_status_history`
11. `add_search_text_column` (needs `products.brand`, added in step 2 via the schema.sql edit)

Everything else under `supabase/migrations/` (sec001–sec005, and the M1/M2a/M2b/M2c migration
files) was **not** replayed — it is already baked into `schema.sql`'s current state and would
either no-op or collide (e.g. duplicate `CREATE POLICY` without `IF NOT EXISTS`).

## Verified after bootstrap

- `list_tables`: 41 tables, all with `rls_enabled: true`.
- Data API smoke test: `GET /rest/v1/pages?select=slug,published` with the anon key returns the
  three seeded system pages. Confirms Data API exposure works without extra grants on a fresh
  project (contrary to the possibility STATUS.md item 5 flagged).
- `get_advisors(security)`:
  - **ERROR** — `product_variant_public_availability` is a security-definer-style view (no
    `security_invoker`, unlike `reservations_view` which was fixed in `20261105200000`). This
    may be intentional per the M2c design note (C5: the view exists specifically to expose an
    aggregate to `anon` without granting `reservations` access), but it is flagged at ERROR
    level by Supabase's linter and should get an explicit decision recorded, not silence.
  - WARN — 15 functions have a mutable `search_path` (missing `SET search_path = public`).
    Pre-existing in `schema.sql`, not introduced by this bootstrap.
  - WARN — `decrement_order_stock`, `fulfil_reservation`, `handle_new_user`, `is_admin` are
    `SECURITY DEFINER` and executable by `anon`/`authenticated` via RPC. Each has its own
    internal guard (e.g. `fulfil_reservation` requires a valid active reservation row), so this
    may be by design, but it was never surfaced before because no project existed to run the
    linter against.
  - INFO — RLS enabled with no policy on `notifications`, `otp_requests`: intentional
    (service-role-only tables per existing comments in `schema.sql`).
- `get_advisors(performance)`: `auth_rls_initplan` (56), `multiple_permissive_policies` (123),
  `unindexed_foreign_keys` (26), `unused_index` (43 — expected, table is empty). All pre-existing
  in the RLS policy design, not introduced here; not fixed in this pass.

## Not done

- GitHub secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) still point at
  the stale June-era project; they were not repointed at this project.
- `.github/workflows/test.yml`'s integration tier was not run against this project in this
  session.
- The ERROR-level security-definer-view finding above was not fixed — it needs a decision, not
  a reflexive patch, since `product_variant_public_availability`'s whole purpose is controlled
  anon exposure.
