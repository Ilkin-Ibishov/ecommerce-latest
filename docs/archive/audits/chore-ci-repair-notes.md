# Chore CI Repair — Implementation Notes

**Date:** 2026-11-05  
**Branch:** `chore/ci-repair`

---

## 1. Changes per Item

### Item 1 — Supply `SESSION_SECRET` to CI API Server
- **File:** `.github/workflows/test.yml` (around line 88)
- **Problem:** In M1, `artifacts/api-server/src/index.ts` (lines 22–30) introduced an eager startup probe via `assertSessionSecret()`, which refuses to start the API server if `SESSION_SECRET` is unset or shorter than 32 characters. In `.github/workflows/test.yml`, the `integration-e2e` job step `"Start API server"` configured `PORT`, `NODE_ENV`, and `E2E_DISABLE_AUTH_RATELIMIT`, but omitted `SESSION_SECRET`. Consequently, the API server aborted immediately upon startup, causing the subsequent `"Wait for API health endpoint"` step to time out after 30 seconds and blocking all integration tests from executing.
- **Change:** Added `SESSION_SECRET: ${{ secrets.SESSION_SECRET }}` directly to the `"Start API server"` step's `env:` block.
- **Scope Discipline:**
  - Did not add `SESSION_SECRET` to the `unit` job (the unit tier boots no HTTP server).
  - Did not provide a fallback or dummy string literal in the workflow, adhering to the fail-closed invariant that missing secrets must fail loudly.
  - Kept workflow line endings (LF) and indentation (10 spaces) consistent with surrounding step configurations.

### Item 2 — Update Stale Assertion in OTP Verify Exploration Test
- **File:** `artifacts/api-server/tests/otp-verify-500.exploration.test.ts` (line 183)
- **Problem:** On 2026-07-01, integration tests passed 54 tests and failed only on `otp-verify-500.exploration.test.ts` with:
  ```
  Expected: "Internal server error"
  Received: "Session creation failed"
  ```
- **Route & Code Trace:**
  - Inspected `artifacts/api-server/src/routes/auth.ts`. There are three distinct locations in `auth.ts` that return `{ error: "Session creation failed" }`:
    1. Line 82: `listUsers` recovery failure guard (`if (listErr || !listData?.users)`)
    2. Line 127: `updateUserById` failure guard (`if (updateErr)`)
    3. Line 139: `signInWithPassword` failure guard (`if (signInErr || !signInData.session)`)
  - Traced the test fixture in `otp-verify-500.exploration.test.ts`:
    - The test mocks `adminClient.from("users").maybeSingle()` returning `{ data: null }` (`existingRow` is null).
    - It triggers `admin.auth.admin.createUser()` which is mocked to return `{ data: null, error: { message: "A user with this phone number has already been registered" } }` (`createErr` is truthy).
    - Execution enters the recovery branch at line 74 and calls `admin.auth.admin.listUsers({ perPage: 1000 })`.
    - The mock for `listUsers` returns `{ data: null, error: null }`.
    - The guard `!listData?.users` evaluates to `true`, triggering line 82:
      ```ts
      req.log.error({ err: listErr }, "[OTP Verify] listUsers recovery failed");
      res.status(500).json({ error: "Session creation failed", detail: listErr?.message });
      return;
      ```
    - The route logs the recovery failure, responds with HTTP status 500 and `{ error: "Session creation failed" }`, and immediately returns.
    - Neither `updateUserById` nor `signInWithPassword` is ever reached.
  - Therefore, we can confirm with certainty that this test exercises **Location 1 (lines 79–84 in `src/routes/auth.ts`)**.
- **Change:** Updated line 183 from:
  ```ts
  expect(body.error).toBe(GENERIC_500);
  ```
  to:
  ```ts
  expect(body.error).toBe("Session creation failed");
  ```
- **Scope Discipline:**
  - Did not loosen the assertion to a substring match or regex; used exact string equality.
  - Did not skip or delete the test.
  - Did not modify adjacent lines (e.g., lines 191–195), strictly following the instruction: *"Two small, exact changes. Nothing else. Prescriptive: implement as written, do not refactor anything nearby, do not touch the unit job."*

---

## 2. Test Tiers Run and Status

Per `AGENTS.md` and prompt instructions:
- **Tiers Run Locally:**
  - `pnpm run audit:invariants:strict`: Passed (11/11 invariant suites green).
  - `pnpm run typecheck`: Passed (TypeScript build clean across all workspace projects).
  - `pnpm run test:unit`: Passed (50 test files, 641 tests passed).
- **Tiers Not Run Locally:**
  - `pnpm run test:integration` / CI integration tier: **Not run.** The integration test suite requires live Supabase service credentials and a running local API server, which are supplied exclusively in GitHub Actions CI via repository secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`). We make no claim that integration tests passed locally.
- **Database Migrations:** No migrations were executed against any remote or local Supabase project.

---

## 3. Git Diff Analysis

- Commits made for the chore:
  1. `ci(test): pass SESSION_SECRET to integration-e2e API server` (touches `.github/workflows/test.yml`)
  2. `test(auth): update stale assertion in OTP verify exploration test` (touches `artifacts/api-server/tests/otp-verify-500.exploration.test.ts`)
  3. `docs(audit): record chore-ci-repair notes and verification output` (touches `docs/audits/chore-ci-repair-notes.md`)
- The code changes across the two items touch exactly two files:
  - `.github/workflows/test.yml` (1 line added)
  - `artifacts/api-server/tests/otp-verify-500.exploration.test.ts` (1 line modified)

---

## 4. Real Verification Command Outputs

### `pnpm run audit:invariants:strict`
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
ok    no-expected-quantity-on-staff-endpoints 0 total, 0 new
ok    security-definer-service-role-privileges 0 total, 0 new
ok    stocktake-mutations-check-draft-status 0 total, 0 new

All invariant checks passed.
```

### `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest
> tsc --build

Scope: 5 of 10 workspace projects
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### `pnpm run test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  store-unit  src/__tests__/cart-validation.test.ts (25 tests) 94ms
 ✓  store-unit  src/__tests__/heading-hierarchy.property.test.ts (8 tests) 39ms
 ✓  store-unit  src/lib/settings/theme-engine.property.test.ts (4 tests) 50ms
 ✓  store-unit  src/__tests__/translated-field.property.test.ts (3 tests) 44ms
 ✓  store-unit  src/__tests__/admin-list.property.test.ts (7 tests) 55ms
 ✓  store-unit  src/__tests__/order-tracking.property.test.ts (6 tests) 131ms
 ✓  store-unit  src/lib/settings/cms-rendering.property.test.ts (14 tests) 160ms
 ✓  store-unit  src/__tests__/image-proxy.property.test.ts (5 tests) 59ms
 ✓  store-unit  src/__tests__/i18n-split.property.test.ts (2 tests) 28ms
 ✓  store-unit  src/__tests__/i18n-consistency.test.ts (16 tests) 22ms
 ✓  store-unit  src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 80ms
 ✓  store-unit  src/__tests__/admin-components.property.test.ts (6 tests) 49ms
 ✓  store-unit  src/__tests__/costing-engine-replay.property.test.ts (4 tests) 19ms
 ✓  store-unit  src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 16ms
 ✓  env-validation  tests/env-validation.test.ts (9 tests) 17ms
 ✓  store-unit  src/__tests__/admin-logic.test.ts (32 tests) 21ms
 ✓  store-unit  src/__tests__/allow-negative-stock.test.ts (9 tests) 13ms
 ✓  store-unit  src/lib/settings/context.test.ts (32 tests) 17ms
 ✓  store-unit  src/__tests__/stocktake-variance.test.ts (24 tests) 18ms
 ✓  store-unit  src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 11ms
 ✓  store-unit  src/__tests__/i18n-preservation.test.ts (36 tests) 10ms
 ✓  store-unit  src/__tests__/admin-components.test.ts (17 tests) 13ms
 ✓  store-unit  src/__tests__/barcode-pack-quantity.test.ts (6 tests) 9ms
 ✓  store-unit  src/__tests__/brand-marquee.test.ts (8 tests) 243ms
 ✓  store-unit  src/lib/settings/storefront-rendering.property.test.ts (11 tests) 326ms
 ✓  store-unit  src/__tests__/image-proxy.unit.test.ts (25 tests) 7ms
 ✓  store-unit  src/__tests__/admin-i18n.property.test.ts (2 tests) 14ms
 ✓  store-unit  src/__tests__/queries.test.ts (14 tests) 9ms
 ✓  store-unit  src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 12ms
 ✓  store-unit  src/__tests__/fixtures.test.ts (7 tests) 7ms
 ✓  store-unit  src/lib/settings/default-rendering.test.ts (17 tests) 7ms
 ✓  store-unit  src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 7ms
 ✓  store-unit  src/lib/settings/theme-engine.test.ts (15 tests) 8ms
 ✓  store-unit  src/pages/admin/SettingsPage.test.ts (22 tests) 7ms
 ✓  store-unit  src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 7ms
 ✓  store-unit  src/__tests__/receiving-cost-integrity.test.ts (5 tests) 7ms
 ✓  store-unit  src/__tests__/storefront-ux.property.test.ts (25 tests) 1355ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  1066ms
 ✓  store-unit  src/__tests__/staff-cost-reachability.test.ts (6 tests) 7ms
 ✓  store-unit  src/__tests__/unit-cost-privacy.test.ts (3 tests) 5ms
 ✓  store-unit  src/__tests__/blind-counting-security.test.ts (4 tests) 5ms
 ✓  store-unit  src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 6ms
 ✓  store-unit  src/components/admin/ImageCandidateGrid.test.ts (9 tests) 7ms
 ✓  store-unit  src/__tests__/stocktake-reconciliation.test.ts (4 tests) 6ms
 ✓  store-unit  src/__tests__/stock-adjust-race.test.ts (2 tests) 5ms
 ✓  store-unit  src/__tests__/margin-report-granularity.test.ts (3 tests) 5ms
 ✓  store-unit  src/__tests__/adjustment-role-guards.test.ts (4 tests) 5ms
 ✓  store-unit  src/__tests__/inventory-auth.test.ts (4 tests) 4ms
 ✓  store-unit  src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 4ms
 ✓  store-unit  src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 53ms
 ✓  store-unit  src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 73ms

 Test Files  50 passed (50)
      Tests  641 passed (641)
   Start at  20:15:47
   Duration  4.66s (transform 2.11s, setup 0ms, collect 9.27s, tests 3.18s, environment 2.58s, prepare 11.98s)
```
