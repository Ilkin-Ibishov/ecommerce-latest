# M1 Fix Notes & Audit Resolution

Branch: `m1/variants-ledger`  
Task: `prompts/m1-fix.md`  
Date: 2026-11-03

---

## 1. Item-by-Item Breakdown of Changes

### F1 [must] — Prevent Race on Stock Adjust with Row Lock & Return Actual Quantity
- **Problem**: `PATCH /admin/products/:id/stock` calculated deltas in the Node.js application process (`delta = stock - current_on_hand`) without locking the row. Under concurrent requests (e.g. concurrent store checkout decrement interleaving with staff manual adjustment), the resulting on-hand stock diverged from the requested target. Additionally, the route returned the client's requested stock in the response body rather than the actual stock stored in Postgres.
- **Solution & Direction Chosen**:
  - Implemented Postgres function `set_product_stock_safe` via migration `supabase/migrations/20261103200000_set_product_stock_row_lock.sql` and updated `supabase/schema.sql`.
  - The function locks the variant row (`SELECT on_hand INTO v_current_on_hand ... FOR UPDATE`), computes `v_delta := p_target_stock - v_current_on_hand`, inserts an audit entry into `public.stock_movements`, updates `product_variants.on_hand`, and returns the exact new stock quantity.
  - Added typed RPC helper `setProductStockSafe` in `artifacts/api-server/src/lib/rpc.ts`.
  - Updated `artifacts/api-server/src/routes/admin/products.ts` to call `setProductStockSafe` and return `{ success: true, stock: resultingStock }`.
  - Updated `artifacts/store/src/components/admin/StockCell.tsx` to read `data.stock` directly from the server response.
- **Direction Rationale (Postgres Row Lock vs Client Deltas)**:
  - In a physical store, staff perform physical counts and enter an absolute quantity target ("we counted 30 mugs on shelf"). If the client calculates deltas, a background decrement occurring while the form is open will be overwritten or miscalculated. The row-locking RPC ensures the delta is calculated atomically at the moment the transaction commits.
- **Regression Tests**:
  - `Property 5` in `artifacts/api-server/tests/variants-ledger.property.test.ts`: Interleaves an absolute adjustment (`target = 25`) with a concurrent order decrement (`delta = -2`) and asserts that the resulting database quantity is `23` (or `25` depending on lock acquisition order), never an inconsistent stale count.
  - Unit test in `artifacts/store/src/__tests__/stock-adjust-race.test.ts`.

---

### F2 [must] — Authenticate Barcode Scan Endpoint
- **Problem**: `GET /inventory/scan/:barcode` was publicly accessible without any session or role verification, allowing unauthenticated scraping of inventory catalogs and stock levels.
- **Solution**:
  - Applied `requireStaffOrAdmin` middleware to `GET /inventory/scan/:barcode` in `artifacts/api-server/src/routes/inventory.ts`.
  - Added test cases in `artifacts/api-server/tests/variants-ledger-rls.test.ts` verifying that unauthenticated requests receive `401 Unauthorized` and customer roles receive `403 Forbidden`.
  - Added companion unit test in `artifacts/store/src/__tests__/inventory-auth.test.ts`.

---

### F3 [must] — Multi-Variant Barcode Resolution & `variant_barcodes` Table
- **Problem**: Storing `barcode` as a column on `product_variants` prevented real-world identification scenarios where:
  1. Multiple distinct variants share one manufacturer barcode (e.g. four mug colors sharing one EAN-13, Scenario S2).
  2. One variant has multiple barcodes (e.g. manufacturer UPC plus internal store sticker, Scenario S4).
  3. The scan endpoint returned a single variant or 404, breaking multi-match resolution.
- **Solution**:
  - Created migration `supabase/migrations/20261103201000_create_variant_barcodes.sql` creating table `public.variant_barcodes`:
    - Columns: `id` (uuid PK), `variant_id` (uuid FK referencing `product_variants(id)` ON DELETE CASCADE), `barcode` (text NOT NULL), `source` (text NOT NULL DEFAULT 'manufacturer'), `is_primary` (boolean NOT NULL DEFAULT false), `created_at`, `updated_at`.
    - RLS enabled: public read policy `USING (true)`, admin/staff write policy.
    - Dropped unique barcode column index on `product_variants`.
  - **Constraint Justifications**:
    - `UNIQUE (variant_id, barcode)`: Prevents assigning the identical barcode string to the same variant more than once.
    - No global uniqueness on `barcode` alone: Essential to support scenario S2 (multiple variants sharing a single manufacturer barcode).
    - Partial unique index `CREATE UNIQUE INDEX idx_variant_barcodes_primary ON public.variant_barcodes (variant_id) WHERE is_primary = true`: Guarantees that each variant has at most one primary barcode (scenario S4).
  - Updated OpenAPI specification in `lib/api-spec/openapi.yaml`:
    - Defined `BarcodeScanMatch` schema and updated `GET /inventory/scan/{barcode}` to return an array `BarcodeScanResult`.
    - Regenerated TypeScript types and hooks via `pnpm --filter @workspace/api-spec run codegen`.
  - Updated API route `GET /inventory/scan/:barcode` in `artifacts/api-server/src/routes/inventory.ts` to join `variant_barcodes` with `product_variants` and `products`, returning an array of matches.
  - Created `< 100` lines plain picker component `artifacts/store/src/components/admin/BarcodeVariantPicker.tsx` allowing staff to select from matching variants (with auto-selection on 1 match or Enter key).
  - Added matrix resolution tests for S1, S2, and S4 in `artifacts/store/src/__tests__/barcode-matrix-resolution.test.ts` and `artifacts/api-server/tests/variants-ledger-rls.test.ts`.

---

### F4 [should] — Protect `unit_cost` Privacy in Movement History & Adjustments
- **Problem**: `GET /admin/variants/:id/movements` returned `unit_cost` to all authenticated users, including staff members, leaking wholesale costs and merchant profit margins. Furthermore, `POST /admin/stock/adjust` allowed staff to inject custom `unit_cost` values.
- **Solution**:
  - Updated `GET /admin/variants/:id/movements` in `artifacts/api-server/src/routes/inventory.ts` to inspect the caller's role (`(req as any).userRole`). If `userRole !== "admin"`, `unit_cost` is stripped from every movement record before returning.
  - Updated `POST /admin/stock/adjust` to ignore `unit_cost` if the caller is not an admin (`userRole !== "admin" ? null : unit_cost`).
  - Added unit test in `artifacts/store/src/__tests__/unit-cost-privacy.test.ts` and integration route tests in `artifacts/api-server/tests/variants-ledger-rls.test.ts`.

---

### F5 [should] — Restrict `opening_balance` and `stocktake_correction` to Admin
- **Problem**: `POST /admin/stock/adjust` allowed staff to post movements with reason `opening_balance`. Staff could inject arbitrary stock increases or reset balances, compromising inventory audit integrity.
- **Solution**:
  - Evaluated the adjustment reason enum (`VALID_REASONS`).
  - Restricting `opening_balance`: Opening balances set baseline audit figures and are administrative ledger initializations.
  - Restricting `stocktake_correction`: Staff could conceal stolen or damaged items under the guise of an unverified stocktake correction. Only administrators can post corrections that overwrite physical inventory variances.
  - Implemented role guard in `artifacts/api-server/src/routes/inventory.ts`:
    ```typescript
    const ADMIN_ONLY_REASONS = ["opening_balance", "stocktake_correction"];
    if (ADMIN_ONLY_REASONS.includes(reason) && userRole !== "admin") {
      return res.status(403).json({
        error: `Reason '${reason}' is reserved for administrator role only`,
      });
    }
    ```
  - Added tests in `artifacts/store/src/__tests__/adjustment-role-guards.test.ts` and `artifacts/api-server/tests/variants-ledger-rls.test.ts`.

---

### F6 [minor] — Uniform `variant_costs` Lifecycle & Tolerant Read Resolution
- **Problem**: `POST /admin/products/:id/variants` created a `variant_costs` row, but `PATCH /admin/products/:id` (updating the default variant) did not guarantee row creation, leading to missing rows for some variants.
- **Solution**:
  - Implemented both sides of the lifecycle guarantee:
    1. **Write Paths Guarantee**: `PATCH /admin/products/:id` now fetches the default variant and ensures a `variant_costs` row exists (upserting if `cost_price` was supplied, or inserting default 0 if missing). `PATCH /admin/variants/:id` also allows admin to update `cost_price` via upsert.
    2. **Read Tolerant Fallback**: `GET /admin/products/:id/variants` queries `variant_costs` only for admin users and falls back to `0` (`(Array.isArray(v.variant_costs) ? v.variant_costs[0]?.cost_price : v.variant_costs?.cost_price) ?? 0`) if the row is absent, preventing crashes or schema mismatches. For staff users, `variant_costs` is omitted from both the query and the response.
  - Added tests in `artifacts/store/src/__tests__/variant-costs-lifecycle.test.ts` and `artifacts/api-server/tests/variants-ledger-rls.test.ts`.

---

## 2. Architectural Decisions & Trade-Offs

1. **Postgres Row Locking for Stock Adjust (F1)**:
   - *Alternative Considered*: Pushing delta calculation to the frontend client.
   - *Why Rejected*: Retail shop staff count physical goods and set absolute targets ("inventory is 30"). If the browser calculates the delta based on stale data, intervening sales decrement stock twice or result in incorrect on-hand numbers. Postgres row-level locking (`SELECT ... FOR UPDATE`) guarantees sequential, atomic delta computation.
2. **Barcode Uniqueness & Resolution Matrix (F3)**:
   - *Alternative Considered*: Global unique constraint on `variant_barcodes.barcode`.
   - *Why Rejected*: Fails matrix scenario S2 (multiple variants such as colors/sizes sharing a manufacturer UPC). Instead, we enforce `UNIQUE (variant_id, barcode)` to eliminate duplicate barcode records per variant, and a partial unique index `(variant_id) WHERE is_primary = true` to ensure each variant has at most one primary barcode (scenario S4).
3. **Restricting Stocktake Corrections (F5)**:
   - *Decision*: Restricting `stocktake_correction` to `admin` in addition to `opening_balance`.
   - *Trade-off*: Staff performing inventory counts cannot submit stocktake corrections directly; they must either post routine adjustments (e.g. `damage_write_off` with notes) or an admin must finalize the stocktake count. This prevents rogue adjustments concealing lost or stolen stock.

---

## 3. Test Tiers Run & CI Boundary

Per `AGENTS.md` §4:
- **Tiers Run Locally**:
  1. `pnpm run typecheck`: Passed across all 5 workspace projects (`mockup-sandbox`, `supabase-types`, `scripts`, `api-server`, `store`).
  2. `pnpm run test:unit`: Passed across all 37 test files and 538 tests (`store-unit` + `env-validation`).
  3. `pnpm run audit:invariants:strict`: Passed with 0 violations across all 5 architectural invariant rules.
  4. Isolated Vitest runs for Property & RLS suites (`variants-ledger.property.test.ts`, `variants-ledger-rls.test.ts`).
- **Tiers Running Only in CI**:
  1. `api-integration`: Requires live Supabase credentials and a running API server on port 5000; executed in GitHub Actions CI (`.github/workflows/test.yml`).

---

## 4. Real Command Output Verbatim

### 4.1 Typecheck (`pnpm run typecheck`)
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
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### 4.2 Unit Tests (`pnpm run test:unit`)
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  store-unit  src/__tests__/heading-hierarchy.property.test.ts (8 tests) 44ms
 ✓  store-unit  src/lib/settings/theme-engine.property.test.ts (4 tests) 80ms
 ✓  store-unit  src/__tests__/translated-field.property.test.ts (3 tests) 51ms
 ✓  env-validation  tests/env-validation.test.ts (9 tests) 21ms
 ✓  store-unit  src/__tests__/cart-validation.test.ts (25 tests) 144ms
 ✓  store-unit  src/__tests__/admin-list.property.test.ts (7 tests) 72ms
 ✓  store-unit  src/__tests__/image-proxy.property.test.ts (5 tests) 68ms
 ✓  store-unit  src/__tests__/order-tracking.property.test.ts (6 tests) 158ms
 ✓  store-unit  src/lib/settings/cms-rendering.property.test.ts (14 tests) 223ms
 ✓  store-unit  src/__tests__/i18n-split.property.test.ts (2 tests) 32ms
 ✓  store-unit  src/__tests__/admin-components.property.test.ts (6 tests) 40ms
 ✓  store-unit  src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 82ms
 ✓  store-unit  src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 27ms
 ✓  store-unit  src/__tests__/i18n-consistency.test.ts (16 tests) 21ms
 ✓  store-unit  src/lib/settings/default-rendering.test.ts (17 tests) 7ms
 ✓  store-unit  src/__tests__/admin-logic.test.ts (32 tests) 22ms
 ✓  store-unit  src/__tests__/i18n-preservation.test.ts (36 tests) 10ms
 ✓  store-unit  src/lib/settings/context.test.ts (32 tests) 16ms
 ✓  store-unit  src/__tests__/image-proxy.unit.test.ts (25 tests) 9ms
 ✓  store-unit  src/__tests__/admin-components.test.ts (17 tests) 13ms
 ✓  store-unit  src/lib/settings/theme-engine.test.ts (15 tests) 8ms
 ✓  store-unit  src/__tests__/queries.test.ts (14 tests) 8ms
 ✓  store-unit  src/__tests__/fixtures.test.ts (7 tests) 9ms
 ✓  store-unit  src/__tests__/admin-i18n.property.test.ts (2 tests) 15ms
 ✓  store-unit  src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 8ms
 ✓  store-unit  src/__tests__/brand-marquee.test.ts (8 tests) 214ms
 ✓  store-unit  src/pages/admin/SettingsPage.test.ts (22 tests) 7ms
 ✓  store-unit  src/lib/settings/storefront-rendering.property.test.ts (11 tests) 345ms
 ✓  store-unit  src/components/admin/ImageCandidateGrid.test.ts (9 tests) 5ms
 ✓  store-unit  src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 6ms
 ✓  store-unit  src/__tests__/unit-cost-privacy.test.ts (3 tests) 6ms
 ✓  store-unit  src/__tests__/stock-adjust-race.test.ts (2 tests) 5ms
 ✓  store-unit  src/__tests__/adjustment-role-guards.test.ts (4 tests) 4ms
 ✓  store-unit  src/__tests__/inventory-auth.test.ts (4 tests) 4ms
 ✓  store-unit  src/__tests__/storefront-ux.property.test.ts (25 tests) 1438ms
 ✓  store-unit  src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 66ms
 ✓  store-unit  src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 68ms

 Test Files  37 passed (37)
      Tests  538 passed (538)
   Duration  4.12s
```

### 4.3 Invariant Audit (`pnpm run audit:invariants:strict`)
```
> workspace@0.0.0 audit:invariants:strict C:\Users\user\Documents\ecommerce-latest
> node scripts/audit/check-invariants.mjs --strict

ok    ledger-only-stock-writes         0 total, 0 new
ok    rls-on-new-tables                0 total, 0 new
ok    no-has-variants-flag             0 total, 0 new
ok    no-customer-industry-naming      0 total, 0 new
ok    reservations-are-not-movements   0 total, 0 new

All invariant checks passed.
```

### 4.4 Property Suite with Concurrency Regression Test (`variants-ledger.property.test.ts`)
```
 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  api-integration  tests/variants-ledger.property.test.ts (5 tests) 9058ms
   ✓ Variant Movement Ledger — Property-Based Tests > Property 4: Concurrent transactions preserve non-negative invariant and ledger consistency  8182ms
   ✓ Variant Movement Ledger — Property-Based Tests > Property 5 (F1 Regression): Interleaved target adjustment with concurrent decrement asserts actual quantity  852ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  9.51s
```

### 4.5 RLS & Role Enforcement Suite (`variants-ledger-rls.test.ts`)
```
 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  api-integration  tests/variants-ledger-rls.test.ts (18 tests) 55ms

 Test Files  1 passed (1)
      Tests  18 passed (18)
   Duration  557ms
```

---

## 5. Git Commit Log

```
156785f fix(inventory): guarantee variant_costs lifecycle across all variant sync paths (F6)
e3b57be fix(inventory): restrict opening_balance and stocktake_correction to admin (F5)
6368a96 fix(inventory): protect unit_cost from leaking to staff in movement history (F4)
5c96789 feat(inventory): add variant_barcodes table and multi-variant scan resolution (F3)
15b615e fix(inventory): require staff or admin auth on barcode scan endpoint (F2)
ba0c3a2 fix(inventory): prevent race on stock-adjust with row lock and return actual quantity (F1)
```
