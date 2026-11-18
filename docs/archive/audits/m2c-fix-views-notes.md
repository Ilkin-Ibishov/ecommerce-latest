# M2c View Security Fix Notes & Invariant Verification

Branch: `m2c/reservations`  
Task: `prompts/m2c-fix-views.md`  
Date: 2026-11-05  

---

## 1. Executive Summary

Applying Supabase's security checklist to the M2c schema identified two critical PostgREST view privilege boundaries:
1. **V1 [Blocker]**: `public.reservations_view` was created without `security_invoker = true` and granted to `authenticated`. Because Postgres views run under owner privileges (`postgres`) by default, any signed-in storefront customer holding the `authenticated` role could bypass `public.reservations` RLS and directly query `/rest/v1/reservations_view?select=*`, exposing other customers' full names, phone numbers, agreed prices, paid deposit amounts, and notes.
2. **V2 [Must]**: `public.product_variant_availability` was granted to `authenticated`, exposing commercial shop metrics (`reserved_quantity` and `deficit_quantity`) to customers.
3. **V3 [Must]**: Added the architectural invariant `no-sensitive-columns-in-exposed-views` to `scripts/audit/check-invariants.mjs` ensuring no view granted to `anon` or `authenticated` can expose sensitive customer or commercial columns without `security_invoker = true`.

---

## 2. Item-by-Item Breakdown of Changes

### V1 [Blocker] — `reservations_view` Bypasses RLS and is Granted to `authenticated`

- **Problem**:
  In Postgres, views do not inherit underlying table RLS policies unless explicitly created or altered with `security_invoker = true`. `reservations_view` was owned by `postgres` (bypassing RLS) and granted to `authenticated`. Storefront customers sign in with OTP and receive the `authenticated` role. Any authenticated customer could read all store deposits.
- **Fix Applied**:
  - Added new migration `supabase/migrations/20261105200000_m2c_view_security.sql`:
    ```sql
    ALTER VIEW public.reservations_view SET (security_invoker = true);
    ```
  - Mirrored in `supabase/schema.sql` next to the view definition with an explanatory comment:
    ```sql
    ALTER VIEW public.reservations_view OWNER TO postgres;
    REVOKE ALL ON public.reservations_view FROM anon;
    GRANT SELECT ON public.reservations_view TO authenticated, service_role;
    -- security_invoker ensures calling role's RLS on public.reservations applies (prevents customer data leak)
    ALTER VIEW public.reservations_view SET (security_invoker = true);
    ```
- **Test**:
  - Implemented in `artifacts/store/src/__tests__/m2c-reservations-view-security.test.ts`:
    - Asserts that a customer (non-staff, non-admin) token evaluates underlying RLS to zero rows.
    - Asserts that a staff token returns the seeded reservation rows.
    - Asserts that an anonymous token is refused with 403 Permission Denied.
    - Asserts that DDL declarations in `20261105200000_m2c_view_security.sql` and `supabase/schema.sql` enforce `security_invoker = true`.

### V2 [Must] — `product_variant_availability` Exposes Reserved Quantities to Customers

- **Problem**:
  `product_variant_availability` exposes `reserved_quantity` and `deficit_quantity`. Setting `security_invoker` was not suitable because customers cannot read `public.reservations`, which would cause availability aggregation to return zeros. The view exists for backend aggregation.
- **Fix Applied**:
  - In `supabase/migrations/20261105200000_m2c_view_security.sql`:
    ```sql
    REVOKE ALL ON public.product_variant_availability FROM authenticated;
    GRANT SELECT ON public.product_variant_availability TO service_role;
    ```
  - Mirrored in `supabase/schema.sql`:
    ```sql
    ALTER VIEW public.product_variant_availability OWNER TO postgres;
    REVOKE ALL ON public.product_variant_availability FROM anon, authenticated;
    GRANT SELECT ON public.product_variant_availability TO service_role;
    ```
  - `product_variant_public_availability` retains its `anon` and `authenticated` grants, exposing only `variant_id`, `product_id`, and `available_quantity`.
- **Test**:
  - Updated `artifacts/store/src/__tests__/m2c-reservations-public-grant.test.ts` and added to `artifacts/store/src/__tests__/m2c-reservations-view-security.test.ts`:
    - Asserts that an authenticated customer token reading `product_variant_availability` is refused (403 Permission Denied).
    - Asserts that an anonymous read of `product_variant_public_availability` succeeds and returns `available_quantity` without sensitive fields.
    - Asserts that a `service_role` read of `product_variant_availability` succeeds.
    - Verifies DDL declarations across migration and schema.

### V3 [Must] — Architectural Invariant `no-sensitive-columns-in-exposed-views`

- **Implementation**:
  - Added check `no-sensitive-columns-in-exposed-views` to `scripts/audit/check-invariants.mjs`.
  - Prescribed regex: `/customer_name|customer_phone|agreed_price|paid_amount|reserved_quantity|deficit_quantity|cost|margin/i`.
  - The check parses SQL statements in `supabase/schema.sql` and sequentially across `supabase/migrations/*.sql`.
  - Comment sanitization preserves exact character and line offsets (`--` and `/* */` replaced with whitespace), ensuring precise file:line error reporting.
  - For each view definition, tracks:
    1. Exposed columns in the SELECT clause matching the sensitive regex.
    2. Explicit grant state (`anon`, `authenticated`, `service_role`) through `GRANT` and `REVOKE` statements.
    3. `security_invoker = true` setting via `ALTER VIEW ... SET (security_invoker = true)` or `CREATE VIEW ... WITH (security_invoker = true)`.
  - Validates that any view granted to `anon` or `authenticated` must either set `security_invoker = true` or expose no sensitive columns.
  - Negative test verification confirmed the invariant reliably flags violations (e.g. removing `security_invoker` or granting `authenticated` raises immediate errors).

---

## 3. Note on Test Environment & Customer Token Minting

Per repository house rules (`AGENTS.md` and `.agents/rules/testing.md`):
- The local development checkout and `store-unit` vitest project run purely offline without live Supabase credentials or a running API container.
- Real token minting and live network round-trips against Supabase run exclusively in CI integration pipelines (`.github/workflows/test.yml`).
- Consequently, offline unit tests simulate PostgREST role evaluation (`anon`, `customer`, `staff`, `admin`, `service_role`) and pair this with strict DDL assertions on migration and schema files verifying `security_invoker = true` and `REVOKE ALL ... FROM authenticated`.

---

## 4. Real Command Outputs

### 1. `pnpm run typecheck`

```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest
> tsc --build

Scope: 5 of 10 workspace projects
scripts typecheck$ tsc -p tsconfig.json --noEmit
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### 2. `pnpm run test:unit`

```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  store-unit  src/__tests__/heading-hierarchy.property.test.ts (8 tests) 36ms
 ✓  store-unit  src/__tests__/cart-validation.test.ts (25 tests) 103ms
 ✓  store-unit  src/__tests__/admin-list.property.test.ts (7 tests) 51ms
 ✓  store-unit  src/lib/settings/theme-engine.property.test.ts (4 tests) 49ms
 ✓  store-unit  src/__tests__/translated-field.property.test.ts (3 tests) 108ms
 ✓  store-unit  src/__tests__/image-proxy.property.test.ts (5 tests) 97ms
 ✓  store-unit  src/__tests__/order-tracking.property.test.ts (6 tests) 148ms
 ✓  store-unit  src/lib/settings/cms-rendering.property.test.ts (14 tests) 166ms
 ✓  store-unit  src/__tests__/i18n-split.property.test.ts (2 tests) 29ms
 ✓  store-unit  src/__tests__/i18n-consistency.test.ts (16 tests) 23ms
 ✓  store-unit  src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 77ms
 ✓  store-unit  src/__tests__/admin-components.property.test.ts (6 tests) 40ms
 ✓  store-unit  src/lib/settings/context.test.ts (32 tests) 24ms
 ✓  store-unit  src/__tests__/costing-engine-replay.property.test.ts (4 tests) 40ms
 ✓  env-validation  tests/env-validation.test.ts (9 tests) 36ms
 ✓  store-unit  src/__tests__/barcode-pack-quantity.test.ts (6 tests) 22ms
 ✓  store-unit  src/__tests__/admin-logic.test.ts (32 tests) 55ms
 ✓  store-unit  src/__tests__/allow-negative-stock.test.ts (9 tests) 33ms
 ✓  store-unit  src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 49ms
 ✓  store-unit  src/components/admin/ImageCandidateGrid.test.ts (9 tests) 11ms
 ✓  store-unit  src/__tests__/brand-marquee.test.ts (8 tests) 465ms
 ✓  store-unit  src/__tests__/stocktake-variance.test.ts (24 tests) 60ms
 ✓  store-unit  src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 40ms
 ✓  store-unit  src/lib/settings/storefront-rendering.property.test.ts (11 tests) 841ms
 ✓  store-unit  src/__tests__/admin-components.test.ts (17 tests) 80ms
 ✓  store-unit  src/__tests__/storefront-ux.property.test.ts (25 tests) 2432ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  1622ms
 ✓  store-unit  src/__tests__/inventory-auth.test.ts (4 tests) 14ms
 ✓  store-unit  src/__tests__/staff-cost-reachability.test.ts (6 tests) 22ms
 ✓  store-unit  src/__tests__/image-proxy.unit.test.ts (25 tests) 31ms
 ✓  store-unit  src/__tests__/stocktake-reconciliation.test.ts (4 tests) 18ms
 ✓  store-unit  src/__tests__/admin-i18n.property.test.ts (2 tests) 87ms
 ✓  store-unit  src/__tests__/i18n-preservation.test.ts (36 tests) 45ms
 ✓  store-unit  src/__tests__/queries.test.ts (14 tests) 25ms
 ✓  store-unit  src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 17ms
 ✓  store-unit  src/__tests__/m2c-reservations-order.test.ts (3 tests) 29ms
 ✓  store-unit  src/lib/settings/theme-engine.test.ts (15 tests) 17ms
 ✓  store-unit  src/lib/settings/default-rendering.test.ts (17 tests) 20ms
 ✓  store-unit  src/__tests__/m2c-reservations-suite.test.ts (7 tests) 24ms
 ✓  store-unit  src/pages/admin/SettingsPage.test.ts (22 tests) 16ms
 ✓  store-unit  src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 27ms
 ✓  store-unit  src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 21ms
 ✓  store-unit  src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 31ms
 ✓  store-unit  src/__tests__/receiving-cost-integrity.test.ts (5 tests) 45ms
 ✓  store-unit  src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 26ms
 ✓  store-unit  src/__tests__/blind-counting-security.test.ts (4 tests) 17ms
 ✓  store-unit  src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 12ms
 ✓  store-unit  src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 16ms
 ✓  store-unit  src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 32ms
 ✓  store-unit  src/__tests__/stock-adjust-race.test.ts (2 tests) 15ms
 ✓  store-unit  src/__tests__/fixtures.test.ts (7 tests) 25ms
 ✓  store-unit  src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 36ms
 ✓  store-unit  src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 26ms
 ✓  store-unit  src/__tests__/adjustment-role-guards.test.ts (4 tests) 16ms
 ✓  store-unit  src/__tests__/margin-report-granularity.test.ts (3 tests) 15ms
 ✓  store-unit  src/__tests__/unit-cost-privacy.test.ts (3 tests) 11ms
 ✓  store-unit  src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 26ms
 ✓  store-unit  src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 141ms
 ✓  store-unit  src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 126ms

 Test Files  58 passed (58)
      Tests  670 passed (670)
   Start at  20:53:39
   Duration  12.22s (transform 7.84s, setup 0ms, collect 19.77s, tests 6.14s, environment 6.47s, prepare 36.54s)
```

### 3. `pnpm run audit:invariants:strict`

```
> workspace@0.0.0 audit:invariants:strict C:\Users\user\Documents\ecommerce-latest
> node scripts/audit/check-invariants.mjs --strict

ok    ledger-only-stock-writes         0 total, 0 new
ok    rls-on-new-tables                0 total, 0 new
ok    no-has-variants-flag             0 total, 0 new
ok    no-customer-industry-naming      0 total, 0 new
ok    reservations-are-not-movements   0 total, 0 new
ok    on-hand-repair-setting-isolation 0 total, 0 new
ok    no-direct-variant-costs-writes   0 total, 0 new
ok    no-cost-column-on-staff-tables   0 total, 0 new
ok    no-private-columns-on-anon-grants 0 total, 0 new
ok    no-expected-quantity-on-staff-endpoints 0 total, 0 new
ok    security-definer-service-role-privileges 0 total, 0 new
ok    stocktake-mutations-check-draft-status 0 total, 0 new
ok    no-on-hand-reads-on-storefront   0 total, 0 new
ok    no-sensitive-columns-in-exposed-views 0 total, 0 new

All invariant checks passed.
```
