# M3a test gaps implementation notes

Branch `m3a/test-gaps`. Closes the three untested gaps from `docs/audits/m3-implementation-notes.md`.

## Work completed

### 1. Oversell when `allow_negative_stock` is on
- `artifacts/api-server/tests/serial/m3a-negative-stock.serial.test.ts`: reads `site_settings.id` and verifies `allow_negative_stock === false` in `beforeAll` (failing loudly if true); turns setting on, posts a 2-unit sale against 1 on-hand stock, asserts `status: "posted"`, `on_hand === -1`, and `negative_stock_override === true`; restores setting to `false` in a `finally` block and verifies in `afterAll`.
- `artifacts/api-server/vitest.config.serial.ts`: standalone `api-serial` Vitest config with `fileParallelism: false`.
- `artifacts/api-server/vitest.config.ts`: excludes `tests/serial/**` so parallel integration test runs never pick it up.
- `.github/workflows/test.yml`: added dedicated CI serial test step between parallel API integration and store dev server.
- Differences / column lookup: `site_settings` single row identified by `id`.

### 2. `posted_after_count` after a stocktake snapshot
- `artifacts/api-server/tests/m3a-counter-ledger.integration.test.ts`: added `describe("posted_after_count", ...)` with three tests: void after count (`posted_after_count: true`), post-pending after count (`posted_after_count: true`), and cancelled count (`posted_after_count: false`).
- Created stocktakes cleaned up to `status: 'cancelled'` in `afterEach`.
- Differences: None. Trigger `trg_stocktake_lines_capture_snapshot` and RPC functions match spec.

### 3. Counter screen E2E at desktop and phone width
- `artifacts/store/tests/e2e/counter-sale.spec.ts`: E2E test exercising wedge scanner typing, autofocus, refocus on lookup completion, cash payment, no horizontal scroll at 375px (`scrollWidth <= innerWidth`), status notice, DB verification via service client, and receipt page.
- Differences: None; all UI text and selectors match `CounterPage.tsx`, `LookupBox.tsx`, and `CounterReceiptPage.tsx`.

## Verification tiers

Integration, serial, and E2E suites require Supabase credentials, running API, and store dev server; they run in CI (`integration-e2e` job). They were not run locally.
The three offline verification commands were run locally on Windows (Node 24):

### `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\project-status-merge-2f8c33
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck

> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\project-status-merge-2f8c33
> tsc --build

Scope: 5 of 11 workspace projects
artifacts/supabase-types typecheck$ tsc -p tsconfig.json --noEmit
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### `pnpm run audit:invariants:strict`
```
> workspace@0.0.0 audit:invariants:strict C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\project-status-merge-2f8c33
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
ok    no-client-insert-policy-on-stock-movements 0 total, 0 new
ok    stocktake-mutations-check-draft-status 0 total, 0 new
ok    no-on-hand-reads-on-storefront   0 total, 0 new
ok    no-sensitive-columns-in-exposed-views 0 total, 0 new

All invariant checks passed.
```

### `pnpm test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\project-status-merge-2f8c33
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/project-status-merge-2f8c33

 ✓ |store-unit| src/__tests__/heading-hierarchy.property.test.ts (8 tests) 255ms
 ✓ |store-unit| src/lib/settings/theme-engine.property.test.ts (4 tests) 151ms
 ✓ |store-unit| src/__tests__/cart-validation.test.ts (25 tests) 513ms
 ✓ |store-unit| src/__tests__/counter-pricing.test.ts (10 tests) 234ms
 ✓ |store-unit| src/lib/settings/cms-rendering.property.test.ts (14 tests) 819ms
 ✓ |store-unit| src/__tests__/translated-field.property.test.ts (3 tests) 128ms
 ✓ |store-unit| src/__tests__/order-tracking.property.test.ts (6 tests) 612ms
 ✓ |store-unit| src/__tests__/image-proxy.property.test.ts (5 tests) 234ms
 ✓ |store-unit| src/__tests__/admin-list.property.test.ts (7 tests) 286ms
 ✓ |store-unit| src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 359ms
 ✓ |store-unit| src/__tests__/invariant-definer-grants.test.ts (5 tests) 2123ms
 ✓ |store-unit| src/__tests__/i18n-consistency.test.ts (16 tests) 82ms
 ✓ |store-unit| src/__tests__/brand-marquee.test.ts (8 tests) 1142ms
 ✓ |store-unit| src/__tests__/i18n-split.property.test.ts (2 tests) 147ms
 ✓ |store-unit| src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 73ms
 ✓ |store-unit| src/__tests__/costing-engine-replay.property.test.ts (4 tests) 131ms
 ✓ |store-unit| src/__tests__/admin-i18n.property.test.ts (2 tests) 231ms
 ✓ |store-unit| src/lib/settings/context.test.ts (32 tests) 90ms
 ✓ |env-validation| tests/env-validation.test.ts (9 tests) 96ms
 ✓ |store-unit| src/__tests__/admin-components.test.ts (17 tests) 87ms
 ✓ |store-unit| src/__tests__/admin-logic.test.ts (32 tests) 201ms
 ✓ |store-unit| src/__tests__/admin-components.property.test.ts (6 tests) 372ms
 ✓ |store-unit| src/lib/settings/storefront-rendering.property.test.ts (11 tests) 2074ms
 ✓ |store-unit| src/__tests__/image-proxy.unit.test.ts (25 tests) 32ms
 ✓ |store-unit| src/__tests__/stocktake-variance.test.ts (24 tests) 129ms
 ✓ |store-unit| src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 23ms
 ✓ |store-unit| src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 42ms
 ✓ |store-unit| src/__tests__/allow-negative-stock.test.ts (9 tests) 31ms
 ✓ |store-unit| src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 15ms
 ✓ |store-unit| src/__tests__/i18n-preservation.test.ts (36 tests) 24ms
 ✓ |store-unit| src/__tests__/barcode-pack-quantity.test.ts (6 tests) 32ms
 ✓ |store-unit| src/__tests__/queries.test.ts (14 tests) 41ms
 ✓ |store-unit| src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 31ms
 ✓ |store-unit| src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 20ms
 ✓ |store-unit| src/__tests__/fixtures.test.ts (7 tests) 15ms
 ✓ |store-unit| src/__tests__/staff-cost-reachability.test.ts (6 tests) 25ms
 ✓ |store-unit| src/lib/settings/default-rendering.test.ts (17 tests) 29ms
 ✓ |store-unit| src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 19ms
 ✓ |store-unit| src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 24ms
 ✓ |store-unit| src/__tests__/storefront-ux.property.test.ts (25 tests) 5628ms
 ✓ |store-unit| src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 22ms
 ✓ |store-unit| src/__tests__/unit-cost-privacy.test.ts (3 tests) 20ms
 ✓ |store-unit| src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 11ms
 ✓ |store-unit| src/__tests__/m2c-reservations-order.test.ts (3 tests) 21ms
 ✓ |store-unit| src/pages/admin/SettingsPage.test.ts (22 tests) 23ms
 ✓ |store-unit| src/__tests__/m2c-reservations-suite.test.ts (7 tests) 23ms
 ✓ |store-unit| src/lib/settings/theme-engine.test.ts (15 tests) 25ms
 ✓ |store-unit| src/__tests__/stocktake-reconciliation.test.ts (4 tests) 23ms
 ✓ |store-unit| src/__tests__/blind-counting-security.test.ts (4 tests) 20ms
 ✓ |store-unit| src/__tests__/adjustment-role-guards.test.ts (4 tests) 16ms
 ✓ |store-unit| src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 22ms
 ✓ |store-unit| src/__tests__/stock-adjust-race.test.ts (2 tests) 18ms
 ✓ |store-unit| src/__tests__/receiving-cost-integrity.test.ts (5 tests) 28ms
 ✓ |store-unit| src/__tests__/margin-report-granularity.test.ts (3 tests) 16ms
 ✓ |store-unit| src/__tests__/inventory-auth.test.ts (4 tests) 14ms
 ✓ |store-unit| src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 18ms
 ✓ |store-unit| src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 24ms
 ✓ |store-unit| src/components/admin/ImageCandidateGrid.test.ts (9 tests) 19ms
 ✓ |store-unit| src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 122ms
 ✓ |store-unit| src/__tests__/checkout-form-security.test.ts (1 test) 80ms
 ✓ |store-unit| src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 153ms

 Test Files  61 passed (61)
      Tests  686 passed (686)
   Start at  14:49:21
   Duration  17.49s (transform 12.09s, setup 0ms, collect 36.31s, tests 17.32s, environment 11.30s, prepare 59.00s)
```

## Audit (Claude, 2026-11-11)

The diff touches exactly the files the prompt named. Reviewed every changed line.

- **Fixed:** `counter-sale.spec.ts` checked the quantity with `cartLines.first().getByText("2")`.
  That is a substring match. The fixture title is `Test məhsulu <timestamp>-<random>`, so it almost
  always contains a "2" as well. Two elements match and Playwright fails in strict mode. The check
  now targets the quantity span (`span.tabular-nums`) with `toHaveText("2")`. The notes above say
  "Differences: None" for this item. That was not right.
- **Checked live (read-only) on the test project:**
  - `site_settings` has exactly one row, so updating it by `id` hits the same row the trigger reads
    with `LIMIT 1`;
  - `allow_negative_stock` is currently `false`;
  - no draft stocktakes are left;
  - the E2E admin phone exists and has the role `admin`.
- **Left as is:**
  - Each serial run leaves one fixture variant at `on_hand = -1`. Negative on-hand is exactly the
    state the setting allows, so reports must cope with it anyway.
  - The serial file repeats the ledger test's `sale`/`post` helpers (about 25 lines). Sharing them
    is not worth a new helper module for two files.
- **Not run locally:** integration, serial and E2E. They run in CI only.

## Found by the first CI run (2026-11-11)

The two `posted_after_count` tests that expect `true` got `false`. The tests are right; the test
project was not.

- No snapshot row was written, because `trg_capture_stocktake_line_snapshot` does not exist there.
- A read-only comparison of every function the migrations define against `pg_proc` found exactly
  two missing: that trigger function and `post_stocktake`.
- The tables and columns from `20261104140000`, `20261104150000` and `20261104160000` are present.
  Their functions and trigger are not.
- So stocktake posting has never worked on the test project. No integration test calls
  `post_stocktake`, which is why nothing caught it before.

**Repair:** re-run those three migrations, in order and in one transaction, on the test project.
- They are idempotent: `CREATE OR REPLACE`, `IF [NOT] EXISTS`, and the same `(uuid, uuid) RETURNS
  void` signature throughout.
- No code change is needed.

**Still unverified:** the `post_stocktake` body has never run against the live schema. A
`post_stocktake` integration test would show whether it hits schema drift, as the margin report did.
