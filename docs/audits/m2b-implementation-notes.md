# Phase M2b — Implementation Notes

**Date:** 2026-11-04  
**Branch:** `m2b/stocktake`  
**Spec:** `docs/tasks/warehouse-m2b-stocktake.md`  
**Prompt:** `prompts/m2b-implement.md`  
**Design Note Reference:** `docs/design-notes/m2b-stocktake.md`  

---

## 1. Overview & Architectural Decisions

Phase M2b implements physical stocktaking, the store-wide opening count, blind counting security boundaries, multi-counter reconciliation algebra, and weighted-average shrinkage valuation.

### Core Architectural Resolutions (R1–R5 & §7 Disagreements)

1. **R1: Typo Fix vs. Recount Semantics:**
   - The snapshot capture trigger (`trg_capture_stocktake_line_snapshot`) is strictly `AFTER INSERT`. Updating `counted_quantity` leaves the snapshot where it was.
   - **Typo fix:** Editing a line means "I mistyped". It preserves the original observation moment and original snapshot on-hand.
   - **Recount:** A recount represents a new physical observation. The user deletes the old line and rescans, which captures a fresh snapshot under the database trigger by construction.
   - **UI Enforcement:** The phone counting screen provides two explicit, visually distinct actions: "Fix Typo" (edit modal) and "Recount Shelf" (delete and prompt fresh scan). A recount is completely unreachable by quietly altering a number.

2. **R2: `posting_date` Security and Historical Path Consequence:**
   - `posting_date` is strictly owner-writable. Staff tokens attempting to supply or update `posting_date` are rejected by RLS (`WITH CHECK` enforces `posting_date = (SELECT s.posting_date FROM stocktakes s WHERE s.id = stocktakes.id)`) and stripped by the Express API.
   - `post_stocktake` asserts that `posting_date >= MAX(captured_at)` across all contributing line snapshots. A count cannot be dated before the physical observations it records (`ST010`).
   - **Consequence of Backdated Corrections:** A correction valued at prevailing average does *not* change the unit average cost, leaving the COGS and unit cost of later sales unchanged. However, inserting a correction prior to sales that already occurred corrupts `stock_movement_costs.running_quantity`, potentially driving historical running quantity negative (asserting a shelf state that was never physically true). Because the trigger guards current on-hand rather than the historical trajectory, history is **not** preserved unconditionally.

3. **R3: Location Note Algebra for Duplicate Scans:**
   - Scans for the same variant with **distinct, non-empty location notes** (e.g. Ali at "Shelf A" and Samir at "Store Room") default to `sum`. They appear in review as a resolved group without requiring owner clicks.
   - Scans with **identical or missing location notes** represent suspicious duplicates (two counters counting the same shelf) and strictly block `post_stocktake` (`ST009`) until explicitly resolved by the owner.
   - The owner retains full authority to override defaulted groups to an individual scan if desired.

4. **R4: Honest Limits of Blind Counting:**
   - Isolated `stocktake_line_snapshots`, `stocktake_opening_costs`, and `stocktake_resolutions` in dedicated admin-only tables.
   - Automated invariant check `no-expected-quantity-on-staff-endpoints` asserts that staff endpoints and staff-accessible tables never serialize snapshot or expected quantities.
   - **Honest Boundary:** Blind counting ensures the honest counter is not anchored by a screen value and forces a dishonest counter to query PostgREST directly (leaving an audit trail). However, it does not prevent direct reads of `product_variants.on_hand` because storefront/admin availability paths require that column to be readable. Closing this completely would require revoking authenticated SELECT on `product_variants.on_hand` in favor of a security-definer RPC or view for checkout availability.

5. **R5: Reconciled Snapshot Selection & Interleaved Trade Flag:**
   - Reconciled variant deltas are calculated against the **latest** contributing line's snapshot (`ORDER BY created_at DESC LIMIT 1`).
   - When any stock movement for that variant has a `created_at` between the earliest and latest contributing scan, the variance review flags the group with a warning badge identifying the exact interleaved trade window `[earliest, latest]`. It does not block posting; the owner evaluates whether to recount.

6. **§7.3: Separation of Valued Shrinkage and Unvalued Units:**
   - In shops initializing inventory without known costs (`opening_cost IS NULL`), unit cost is 0 ₼.
   - Reporting 0 ₼ shrinkage would provide false reassurance. The system calculates and displays both:
     - `shrinkage_value`: Monetary loss in manat for items with known cost basis.
     - `unvalued_shrinkage_units`: Total missing physical units with unknown cost basis, surfaced in a prominent warning banner.

7. **Opening Count Mode (§6):**
   - Implemented as a mode of `stocktakes` (`is_opening_count = true`).
   - Posts `opening_balance` movements (rather than `stocktake_correction`), establishing base stock without distorting weighted-average cost formulas.
   - Applies wholesale costs from `stocktake_opening_costs` to `variant_costs.opening_cost` and `cost_price`.
   - Enforces unique partial index `idx_single_posted_opening_stocktake` on `(is_opening_count) WHERE (is_opening_count = true AND status = 'posted')` guaranteeing at most one posted opening count in tenant history.

---

## 2. Changes by Migration

### Migration 1: Schema Tables & RLS Policies (`20261104130000_m2b_stocktake_tables.sql`)
- Created `public.stocktakes` header table with status check (`draft`, `posted`, `cancelled`), `is_opening_count`, and `posting_date`.
- Created partial unique index `idx_single_posted_opening_stocktake`.
- Created `public.stocktake_lines` table (quantities, counter attribution, location note; zero cost or snapshot columns).
- Created `public.stocktake_line_snapshots` table (strictly admin-only RLS).
- Created `public.stocktake_opening_costs` table (strictly admin-only RLS).
- Created `public.stocktake_resolutions` table (strictly admin-only RLS).

### Migration 2: Triggers & Posting RPC (`20261104140000_m2b_stocktake_functions.sql`)
- `trg_capture_stocktake_line_snapshot`:
  - `AFTER INSERT` trigger on `stocktake_lines` executing with `SECURITY DEFINER` privileges.
  - Captures authoritative system on-hand directly into `stocktake_line_snapshots`.
- `post_stocktake(p_stocktake_id, p_actor_id)`:
  - Atomic single-transaction boundary. Exclusively locks header row `FOR UPDATE`.
  - Enforces R2 posting date guard (`ST010`).
  - Enforces R3 location collision check (`ST009`).
  - Populates `variant_costs.opening_cost` for opening counts.
  - Reconciles multi-counter scans against latest snapshots (R5) and inserts movements (`quantity_delta <> 0`).
  - Triggers scoped cost recomputation for affected variants via `recompute_variant_cost`.
  - Marks stocktake posted with transaction attribution.
- Enforced PostgreSQL service-role privileges with explicit `REVOKE EXECUTE ... FROM public` and `GRANT EXECUTE ... TO service_role`.

---

## 3. API & Admin UI Layer

### API Specification & Codegen
- Updated `lib/api-spec/openapi.yaml` with tag `stocktakes` and endpoints:
  - `GET /admin/stocktakes`, `POST /admin/stocktakes`
  - `GET /admin/stocktakes/{id}`, `PATCH /admin/stocktakes/{id}`, `DELETE /admin/stocktakes/{id}`
  - `POST /admin/stocktakes/{id}/lines`, `PATCH /admin/stocktakes/{id}/lines/{lineId}`, `DELETE /admin/stocktakes/{id}/lines/{lineId}`
  - `GET /admin/stocktakes/{id}/variance` (Owner only)
  - `POST /admin/stocktakes/{id}/resolve` (Owner only)
  - `POST /admin/stocktakes/{id}/opening-costs` (Owner only)
  - `POST /admin/stocktakes/{id}/post` (Owner only)
- Regenerated React Query hooks and Zod schemas via Orval.

### API Routes & Variance Logic
- `artifacts/api-server/src/lib/stocktake-variance.ts`: Pure variance calculation, monetary discrepancy sorting (`ABS(variance_value) DESC`), and R5 interleaved trade detection.
- `artifacts/api-server/src/routes/admin/stocktake-lines.ts`: Staff-facing scanning, typo editing, and recount deletion. Strips all snapshots.
- `artifacts/api-server/src/routes/admin/stocktakes.ts`: Stocktake document lifecycle, owner variance review, conflict resolution, and atomic posting.

### Admin UI Components (All files strictly < 200 lines)
- `artifacts/store/src/pages/admin/StocktakesPage.tsx`: Document listing, status tabs, and entry points.
- `artifacts/store/src/pages/admin/StocktakeCountPage.tsx`: Primary deliverable phone-first counting screen. Barcode scanner input, blind counting (zero expected quantity shown), quantity stepper, and recent scan list.
- `artifacts/store/src/components/admin/StocktakeTypoModal.tsx`: Explicit modal for correcting typos (preserving snapshot).
- `artifacts/store/src/components/admin/StocktakeRecentLines.tsx`: List of recent scans with distinct "Fix Typo" vs "Recount Shelf" buttons.
- `artifacts/store/src/pages/admin/StocktakeVariancePage.tsx`: Owner review screen with shrinkage KPI in manat, unvalued missing units alert, and discrepancy breakdown.
- `artifacts/store/src/components/admin/StocktakeResolutionCard.tsx`: Multi-counter resolution widget supporting location-based sum defaults and manual overrides.
- `artifacts/store/src/components/admin/NewStocktakeModal.tsx`: Modal for creating regular stocktakes or go-live opening count documents.
- Full localization in Azerbaijani (`az.ts`), English (`en.ts`), and Russian (`ru.ts`).

---

## 4. Verification Commands & Real Outputs

### 1. Architectural Invariants Check
Command: `pnpm run audit:invariants:strict`
```text
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

All invariant checks passed.
```

### 2. TypeScript Typecheck
Command: `pnpm run typecheck`
```text
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck

> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest
> tsc --build

Scope: 5 of 10 workspace projects
artifacts/mockup-sandbox typecheck: Done
scripts typecheck: Done
artifacts/supabase-types typecheck: Done
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```
(Exit code 0 across all workspace projects.)

### 3. Unit & Invariant Test Suite
Command: `pnpm run test:unit`
```text
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  store-unit  src/__tests__/stocktake-reconciliation.test.ts (4 tests) 6ms
 ✓  store-unit  src/__tests__/stocktake-posting-integrity.test.ts (5 tests) 7ms
 ✓  store-unit  src/__tests__/blind-counting-security.test.ts (4 tests) 6ms
 ✓  store-unit  src/__tests__/storefront-ux.property.test.ts (25 tests) 1563ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label (200 runs)
 ✓  store-unit  src/__tests__/i18n-consistency.test.ts (16 tests)
 ...
 Test Files  48 passed (48)
      Tests  595 passed (595)
   Duration  5.00s
```

---

## 5. What You Cannot Verify, and Must Not Claim

No migration in this repository has ever been executed against a real Postgres, and the CI integration tier has been failing since July — its repair is postponed deliberately. The SQL migrations (`20261104130000_m2b_stocktake_tables.sql` and `20261104140000_m2b_stocktake_functions.sql`) are checked only by a TypeScript re-implementation of their logic and structural invariant linters.

Migrations must be run in order (`130000` then `140000`) against a live Postgres database. Remote Supabase projects were **not** modified or migrated during this task. Local execution ran all unit, property, invariant, and typecheck suites.
