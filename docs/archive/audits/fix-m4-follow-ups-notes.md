# Audit & Implementation Notes — M4 Follow-ups Fix Round

**Date:** 2026-11-16  
**Branch:** `fix/m4-follow-ups` (cut from `main` at `711781c`)  
**Inputs:** `prompts/fix-m4-follow-ups.md`, `AGENTS.md`, `.agents/rules/express5-api.md`, `.agents/rules/frontend.md`, `.agents/rules/testing.md`

---

## 1. What Changed Per Item

### Item 1: The four signal settings are seeded and never read

- **`artifacts/api-server/src/routes/admin/inventory-signals.ts`**:
  - Added exported pure function `parseSignalSettings(rows: { key: string; value: string }[])` returning `{ deadStockDays, reorderTargetDays, reorderWindowDays, reorderMinSales }`. Each value parses as an integer $\ge 1$ via `Number.isInteger(num) && num >= 1`, falling back to the defaults (90 / 60 / 28 / 3). Missing rows and non-positive-integer inputs fallback to defaults; unknown keys are ignored.
  - Added async helper `getSignalSettings(req: Request)` selecting `key, value` from `store_settings` for the four keys via service client `getAdminSupabase()`. Logs errors via `(req.log || logger).error` and returns defaults on error or exception without empty catch blocks (conforming to `signals-have-one-derivation`).
  - Summary route (`GET /admin/inventory/signals/summary`): Replaced hardcoded values (90, 28, 60, 3) with dynamic settings from `getSignalSettings(req)`.
  - Dead-stock route (`GET /admin/inventory/signals/dead-stock`): Query parameter `days` is used when present and a valid integer $\ge 1$, otherwise falls back to `settings.deadStockDays`. Added effective `days` number to both admin and staff JSON response payloads.
  - Reorder route (`GET /admin/inventory/signals/reorder`): Query parameters `windowDays`, `targetDays`, and `minSales` are used when present and valid integers $\ge 1$, otherwise falling back to their respective settings.
  - Row schemas (`lowStockRowSchema`, `deadStockRowSchema`, `reorderSuggestionRowSchema`) were untouched, preserving exact parity with SQL `RETURNS TABLE` definitions verified by `invariant-stock-signals-schema.test.ts`.
- **`artifacts/store/src/pages/admin/InventoryPage.tsx`**:
  - Changed `notSellingDays` state to `number | null`, initial `null`.
  - Effect appends `?days=${notSellingDays}` only when `notSellingDays !== null`.
  - When the response arrives and `notSellingDays === null`, sets state from `data.days` when it is a number. Button list `[30, 60, 90, 180]` is preserved.
- **`artifacts/store/src/__tests__/signal-settings.test.ts`**:
  - Added new offline unit test suite importing `parseSignalSettings` directly from `artifacts/api-server/src/routes/admin/inventory-signals`. Tested: all four rows valid, empty list defaulting, invalid values (`"0"`, `"-5"`, `"abc"`, `""`, `"2.5"`), and unknown keys ignored.

**Commit:** `f7b0766 fix(inventory): read signal settings from store_settings`

---

### Item 2: The inventory page shows stale numbers when its requests fail

- **`artifacts/store/src/pages/admin/InventoryPage.tsx`**:
  - Added `loadError` boolean state initialized to `false`.
  - In `loadData`: reset `setLoadError(false)` at start; if either `GET /admin/inventory/availability` or `GET /admin/inventory/signals/low-stock` rejects or is not `ok`, sets `setLoadError(true)`, `setLoading(false)` and returns immediately without calling `setProducts`.
  - Rendered error state with `role="alert"` showing `t("Admin.Common.networkError")` and a retry button calling `loadData` using `t("Admin.Common.retry")` in place of the stat cards, filters, and table. Both translation keys exist in `az.ts`, `ru.ts`, and `en.ts`.
  - Removed `p.stock` fallback in availability mapping: when a product has no row in the availability map, values default to `on_hand: 0, reserved_quantity: 0, available_quantity: 0, deficit_quantity: 0`.
  - Removed `< 10` fallback branches from `lowStock` count and filter: count and filter use `lowStockProductIds` only.
  - Kept `products` query (`:118-121`) and `healthy` stock definitions (`:207`, `:221`) unchanged.
- **`artifacts/store/src/__tests__/m4-stock-signals-ui.test.ts`**:
  - Updated local copy of `filterLowStockProducts` to match the new rule without `< 10` fallback.
  - Added test case verifying that an empty `lowStockVariantProductIds` set returns an empty array and does not fall back to `< 10`.

**Commit:** `13afd7c fix(inventory): handle load errors and remove stale fallback in inventory page`

---

### Item 3: A cost-privacy test that passes when its fixture is missing

- **`artifacts/api-server/tests/m4-stock-signals.integration.test.ts`**:
  - Replaced conditional blocks `if (staffVar)` and `if (adminVar)` with unconditional `expect(staffVar).toBeDefined();` and `expect(adminVar).toBeDefined();` followed by the property checks (`unit_cost` and `capital_tied_up`).

**Commit:** `b54c547 test(inventory): strengthen dead-stock cost privacy assertions`

---

## 2. Tests Added, Changed, Strengthened, Deleted, or Weakened

- **Tests added:**
  - `artifacts/store/src/__tests__/signal-settings.test.ts`:
    - `parseSignalSettings > uses provided values when all four rows are valid positive integers`
    - `parseSignalSettings > returns default values when rows list is empty`
    - `parseSignalSettings > falls back to defaults for invalid values: '0', '-5', 'abc', '', '2.5'`
    - `parseSignalSettings > ignores unknown keys and keeps defaults for missing settings`
- **Tests changed:**
  - `artifacts/store/src/__tests__/m4-stock-signals-ui.test.ts`:
    - Updated `filterLowStockProducts` helper to remove `< 10` fallback.
    - Added test case: `Inventory Page Signals Filtering > does not fall back to < 10 when lowStockVariantProductIds is empty`.
- **Tests strengthened:**
  - `artifacts/api-server/tests/m4-stock-signals.integration.test.ts`:
    - In `Phase M4 Stock Signals Integration Tests > 1. cost privacy RLS: GET /admin/inventory/signals/dead-stock strips unit_cost/capital_tied_up for staff`, replaced conditional assertions with unconditional `expect(staffVar).toBeDefined();` and `expect(adminVar).toBeDefined();`.
- **Tests deleted, renamed, moved, or weakened:**
  - None.

---

## 3. Blocked / Assumptions / Not Verified

- **Integration Tier Not Run:**
  - `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` belongs to `api-integration`. The integration tier requires live Supabase credentials and a running API server on port 5000; it was **not run locally** by the agent and runs in CI (`.github/workflows/test.yml`).
- **Browser Not Run:**
  - Nothing was run in a browser. UI behavior was verified via unit tests (`pnpm test:unit`) and TypeScript compiler checks (`pnpm run typecheck`).
- **Assumptions:**
  - Assumed the fixture variant created in `m4-stock-signals.integration.test.ts:111` with `daysAgo: 100` and `onHand: 5` satisfies the dead-stock condition for `days=90` (100 days without sales $\ge 90$ days threshold), ensuring `expect(staffVar).toBeDefined()` and `expect(adminVar).toBeDefined()` succeed in CI.
  - Confirmed `Admin.Common.networkError` and `Admin.Common.retry` exist across all 3 translation dictionaries (`az.ts`, `ru.ts`, `en.ts`).

---

## 4. Real Output of Commands

### `pnpm run typecheck`

```text
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-m4-follow-ups
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-m4-follow-ups
> tsc --build

Scope: 5 of 11 workspace projects
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### `pnpm test:unit`

```text
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-m4-follow-ups
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/fix-m4-follow-ups

 ✓ |store-unit| src/__tests__/heading-hierarchy.property.test.ts (8 tests) 202ms
 ✓ |store-unit| src/__tests__/cart-validation.test.ts (25 tests) 418ms
 ✓ |store-unit| src/__tests__/translated-field.property.test.ts (3 tests) 189ms
 ✓ |store-unit| src/__tests__/admin-list.property.test.ts (7 tests) 298ms
 ✓ |store-unit| src/__tests__/image-proxy.property.test.ts (5 tests) 458ms
 ✓ |store-unit| src/__tests__/order-tracking.property.test.ts (6 tests) 772ms
 ✓ |store-unit| src/lib/settings/cms-rendering.property.test.ts (14 tests) 1120ms
 ✓ |store-unit| src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 558ms
 ✓ |store-unit| src/__tests__/invariant-definer-grants.test.ts (5 tests) 2741ms
 ✓ |store-unit| src/__tests__/admin-components.property.test.ts (6 tests) 387ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals.test.ts (7 tests) 3295ms
 ✓ |store-unit| src/lib/settings/theme-engine.property.test.ts (4 tests) 250ms
 ✓ |store-unit| src/__tests__/i18n-split.property.test.ts (2 tests) 111ms
 ✓ |store-unit| src/__tests__/admin-logic.test.ts (32 tests) 84ms
 ✓ |store-unit| src/__tests__/stocktake-variance.test.ts (24 tests) 85ms
 ✓ |env-validation| tests/env-validation.test.ts (9 tests) 130ms
 ✓ |store-unit| src/__tests__/invariant-counter-sale-payments.test.ts (10 tests) 4932ms
 ✓ |store-unit| src/__tests__/admin-components.test.ts (17 tests) 28ms
 ✓ |store-unit| src/__tests__/brand-marquee.test.ts (8 tests) 1934ms
 ✓ |store-unit| src/__tests__/counter-pricing.test.ts (10 tests) 181ms
 ✓ |store-unit| src/lib/settings/storefront-rendering.property.test.ts (11 tests) 3326ms
 ✓ |store-unit| src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 19ms
 ✓ |store-unit| src/lib/settings/theme-engine.test.ts (15 tests) 20ms
 ✓ |store-unit| src/__tests__/queries.test.ts (14 tests) 39ms
 ✓ |store-unit| src/__tests__/receiving-cost-integrity.test.ts (5 tests) 33ms
 ✓ |store-unit| src/__tests__/i18n-consistency.test.ts (16 tests) 73ms
 ✓ |store-unit| src/__tests__/costing-engine-replay.property.test.ts (4 tests) 108ms
 ✓ |store-unit| src/__tests__/m4-stock-signals-ui.test.ts (5 tests) 15ms
 ✓ |store-unit| src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 43ms
 ✓ |store-unit| src/__tests__/m4-stock-signals.unit.test.ts (15 tests) 15ms
 ✓ |store-unit| src/lib/settings/context.test.ts (32 tests) 51ms
 ✓ |store-unit| src/__tests__/admin-i18n.property.test.ts (2 tests) 150ms
 ✓ |store-unit| src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 44ms
 ✓ |store-unit| src/__tests__/allow-negative-stock.test.ts (9 tests) 42ms
 ✓ |store-unit| src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 23ms
 ✓ |store-unit| src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 24ms
 ✓ |store-unit| src/lib/settings/default-rendering.test.ts (17 tests) 29ms
 ✓ |store-unit| src/__tests__/m2c-reservations-order.test.ts (3 tests) 27ms
 ✓ |store-unit| src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 24ms
 ✓ |store-unit| src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 21ms
 ✓ |store-unit| src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 26ms
 ✓ |store-unit| src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 41ms
 ✓ |store-unit| src/pages/admin/SettingsPage.test.ts (22 tests) 23ms
 ✓ |store-unit| src/__tests__/m2c-reservations-suite.test.ts (7 tests) 17ms
 ✓ |store-unit| src/__tests__/staff-cost-reachability.test.ts (6 tests) 27ms
 ✓ |store-unit| src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 25ms
 ✓ |store-unit| src/__tests__/stocktake-reconciliation.test.ts (4 tests) 21ms
 ✓ |store-unit| src/components/admin/ImageCandidateGrid.test.ts (9 tests) 11ms
 ✓ |store-unit| src/__tests__/fixtures.test.ts (7 tests) 14ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals-schema.test.ts (4 tests) 13ms
 ✓ |store-unit| src/__tests__/storefront-ux.property.test.ts (25 tests) 8058ms
 ✓ |store-unit| src/__tests__/blind-counting-security.test.ts (4 tests) 33ms
 ✓ |store-unit| src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 14ms
 ✓ |store-unit| src/__tests__/adjustment-role-guards.test.ts (4 tests) 10ms
 ✓ |store-unit| src/__tests__/stock-adjust-race.test.ts (2 tests) 16ms
 ✓ |store-unit| src/__tests__/unit-cost-privacy.test.ts (3 tests) 19ms
 ✓ |store-unit| src/__tests__/m4-null-availability.unit.test.ts (15 tests) 58ms
 ✓ |store-unit| src/__tests__/margin-report-granularity.test.ts (3 tests) 18ms
 ✓ |store-unit| src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 19ms
 ✓ |store-unit| src/__tests__/inventory-auth.test.ts (4 tests) 14ms
 ✓ |store-unit| src/__tests__/signal-settings.test.ts (4 tests) 102ms
 ✓ |store-unit| src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 208ms
 ✓ |store-unit| src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 216ms
 ✓ |store-unit| src/__tests__/checkout-form-security.test.ts (1 test) 116ms

 Test Files  68 passed (68)
      Tests  746 passed (746)
   Start at  14:08:15
   Duration  22.38s (transform 16.68s, setup 0ms, collect 55.30s, tests 31.55s, environment 16.15s, prepare 63.46s)
```

### `pnpm run audit:invariants`

```text
> workspace@0.0.0 audit:invariants C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-m4-follow-ups
> node scripts/audit/check-invariants.mjs

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
ok    no-client-insert-policy-on-stock-movements 0 total, 0 new
ok    stocktake-mutations-check-draft-status 0 total, 0 new
ok    no-on-hand-reads-on-storefront   0 total, 0 new
ok    no-sensitive-columns-in-exposed-views 0 total, 0 new
ok    no-client-writes-on-counter-sale-payments 0 total, 0 new
ok    post-counter-sale-writes-payments 0 total, 0 new
ok    no-non-tracked-variant-movements 0 total, 0 new
ok    signals-have-one-derivation      0 total, 0 new
ok    no-undispatched-notification-type 0 total, 0 new

All invariant checks passed.
```
