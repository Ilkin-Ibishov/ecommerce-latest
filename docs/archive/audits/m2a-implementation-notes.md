# Phase M2a — Implementation Notes

**Date:** 2026-11-04  
**Branch:** `m2/receiving-cost`  
**Spec:** `docs/tasks/warehouse-m2a-receiving-cost.md`  
**Prompt:** `prompts/m2a-implement.md`  
**Design Note Reference:** `docs/design-notes/m2a-receiving-cost.md`  

---

## 1. Overview & Architectural Decisions

Phase M2a implements supplier management, goods receipts with barcode-driven intake, landed cost distribution, weighted-average costing via idempotent replay, and owner-only gross margin reporting.

### Core Architectural Resolutions
1. **Partial Replay Equivalence Theorem (R1):**
   - The costing replay engine partitions historical movement costs into three strictly disjoint sets:
     - **Carried-forward:** $\{ c \in \text{SMC} \mid c.\text{created\_at} < t_{\text{from}} \}$ (untouched).
     - **Deleted:** $\{ c \in \text{SMC} \mid c.\text{created\_at} \ge t_{\text{from}} \}$ (purged).
     - **Replayed:** newly computed costs for movements $\{ m \in \text{SM} \mid m.\text{posting\_date} \ge t_{\text{from}} \}$.
   - Storing `created_at` directly on `stock_movement_costs` ensures the projection reproduces its own exact ordering key without ambiguous joins back to `stock_movements`.
2. **Staff Token Cost Isolation & RLS Boundary (R5, Q2):**
   - `stock_movements.unit_cost` was permanently dropped to eliminate the PostgREST staff projection leak. Opening balance cost is securely carried in `variant_costs.opening_cost` (admin only).
   - Additional landed costs are stored in `public.goods_receipt_costs` with `public.is_admin()` RLS policy, ensuring staff cannot observe costs even if they can view receipt status and quantities.
   - `goods_receipt_line_costs` and `stock_movement_costs` are strictly restricted to admin.
3. **Single Unified Time Axis & Revenue Granularity Fix:**
   - Both COGS and revenue query `stock_movements.posting_date` as the single unified time axis.
   - Fixed the line-level revenue defect identified in the review: order items are pre-aggregated to one row per `(order_id, variant_id)` with `unit_price = SUM(line_total) / SUM(quantity)`. This eliminates join fan-out and ensures partial returns (e.g., 3 sold, 1 returned) scale revenue to exactly 2 net units, 2 units of COGS, and 2 units of revenue.
4. **Repair Setting Isolation (`inventory.allow_on_hand_repair`):**
   - Documented in `.agents/rules/inventory.md`.
   - Enforced by automated invariant check `on-hand-repair-setting-isolation`: no file outside `20261104110000_m2a_functions_triggers.sql` is permitted to set or reference `inventory.allow_on_hand_repair`.

---

## 2. Changes by Migration

### Migration 1: Schema Tables & Boundary (`20261104100000_m2a_schema_tables.sql`)
- Created `public.suppliers` table with full RLS (staff/admin read, admin write).
- Created `public.goods_receipts` table with `status` enum (`draft`, `posted`, `reversed`), `receipt_number`, `supplier_id`, `posting_date`, and `notes`. Readable by staff; no cost columns.
- Created `public.goods_receipt_costs` table (admin-only) storing additional landed costs (shipping, customs, handling).
- Created `public.goods_receipt_lines` table (staff readable; variant, quantity, notes; no cost columns).
- Created `public.goods_receipt_line_costs` table (admin-only; unit cost and total cost per line).
- Created `public.stock_movement_costs` table (admin-only; running quantity, running valuation, unit cost, total cost, `created_at`).
- Added `variant_costs.opening_cost` (admin-only). Dropped legacy `stock_movements.unit_cost`.
- Added `allow_negative_stock` tenant setting (default false) and `negative_stock_override` on `stock_movements`.
- Added immutable unit of measure trigger `trg_guard_variant_uom_immutable` (`ST005`).

### Migration 2: Functions, Triggers, & Integrity RPCs (`20261104110000_m2a_functions_triggers.sql`)
- `recompute_variant_cost(p_variant_id, p_from_timestamp)`:
  - Replays historical movements from `p_from_timestamp` using the weighted-average cost formula:
    $$\bar{c}_{\text{new}} = \frac{Q_{\text{prev}} \cdot \bar{c}_{\text{prev}} + \Delta Q \cdot c_{\text{in}}}{Q_{\text{prev}} + \Delta Q}$$
  - Outgoing movements (sales, scrap, damage) draw valued cost from the current running average.
  - Returns draw cost from original sale movement reference, falling back to current average.
- `post_goods_receipt(p_receipt_id, p_actor_id)`:
  - Validates draft status and non-empty lines.
  - Proportionally allocates additional landed costs across lines.
  - Inserts atomic movements (`quantity_delta > 0`, reason `goods_receipt`).
  - Records cost in `stock_movement_costs` and updates `variant_costs.cost_price`.
- `reverse_goods_receipt(p_receipt_id, p_actor_id, p_reason)`:
  - Atomically posts compensating negative movements (`goods_receipt_reversal`).
  - Re-triggers cost recomputation from receipt posting date.
- `rebuild_on_hand(p_variant_id)`:
  - Repair function recalculating `on_hand = COALESCE(SUM(quantity_delta), 0)`.
  - Sets `SET LOCAL inventory.allow_on_hand_repair = 'true'` to satisfy the `on_hand` guard trigger.
- `verify_stock_integrity()`:
  - Detects and reports divergences between ledger sum vs `product_variants.on_hand`, and ledger sum vs `stock_movement_costs.running_quantity`.
- `set_variant_stock_safe()`:
  - Renamed from `set_product_stock_safe` for parameter/behaviour naming consistency.
- `get_margin_report(p_from, p_to, p_category_id)`:
  - Computes unified margin metrics using `SUM(line_total) / SUM(quantity)` weighted unit price.

### Migration 3: Historical Cost Replay Backfill (`20261104120000_m2a_cost_backfill.sql`)
- Iterates over all active variants, reads opening balance and existing movements, and replays costs into `stock_movement_costs` and `variant_costs`.

---

## 3. API & Admin UI Layer

### Regenerated OpenAPI Contracts
- Updated `lib/api-spec/openapi.yaml` with endpoints for `/admin/suppliers`, `/admin/receipts`, `/admin/receipts/{id}/post`, `/admin/receipts/{id}/reverse`, and `/admin/margins`.
- Generated typed React Query hooks and schemas using Orval (`pnpm --filter @workspace/api-spec run codegen`).

### API Routes
- `artifacts/api-server/src/routes/admin/suppliers.ts`: Full CRUD for suppliers.
- `artifacts/api-server/src/routes/admin/receipts.ts`: Draft creation, retrieval, atomic posting, and reversal.
- `artifacts/api-server/src/routes/admin/receipt-lines.ts`: Line item additions and deletions.
- `artifacts/api-server/src/routes/admin/margins.ts`: Owner-only margin analytics endpoint (`requireAdmin`).

### Admin UI Components (All files strictly < 200 lines)
- `artifacts/store/src/pages/admin/SuppliersPage.tsx` & `SupplierModal.tsx`: Supplier management and active status filters.
- `artifacts/store/src/pages/admin/ReceiptsPage.tsx` & `NewReceiptModal.tsx`: Receipts listing and draft creation.
- `artifacts/store/src/pages/admin/ReceiptDetailPage.tsx`: Header, status badges, atomic post/reverse controls.
- `artifacts/store/src/components/admin/ReceiptScannerBar.tsx`: Barcode scanning intake, pack multiplier auto-resolution, and candidate disambiguation via `BarcodeVariantPicker`.
- `artifacts/store/src/components/admin/ReceiptLinesTable.tsx` & `ReceiptCostSummary.tsx`: Line items with conditional cost visibility (hidden from staff role).
- `artifacts/store/src/pages/admin/MarginReportPage.tsx`, `MarginKpis.tsx`, `MarginContributorsTable.tsx`: Owner-only margin analytics dashboard.
- Full trilingual localization in `az.ts`, `en.ts`, and `ru.ts`.

---

## 4. Invariant Audit Rules

Added three new architectural invariant checks to `scripts/audit/check-invariants.mjs`:
1. `on-hand-repair-setting-isolation`: Asserts that `inventory.allow_on_hand_repair` is referenced solely within the repair migration `20261104110000_m2a_functions_triggers.sql`.
2. `no-direct-variant-costs-writes`: Asserts that no migrations or application code write directly to `variant_costs` outside authorized modules.
3. `no-cost-column-on-staff-tables`: Asserts that neither `stock_movements`, `goods_receipts`, nor `goods_receipt_lines` define a unit or total cost column.

---

## 5. Verification Commands & Real Outputs

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

### 3. Unit & Property Test Suite
Command: `pnpm run test:unit`
```text
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  store-unit  src/__tests__/costing-engine-replay.property.test.ts (3 tests)
 ✓  store-unit  src/__tests__/receiving-cost-integrity.test.ts (4 tests)
 ✓  store-unit  src/__tests__/margin-report-granularity.test.ts (2 tests)
 ✓  store-unit  src/__tests__/staff-cost-reachability.test.ts (6 tests)
 ✓  store-unit  src/__tests__/m2a-admin-ui-components.test.ts (7 tests)
 ✓  store-unit  src/__tests__/i18n-consistency.test.ts (16 tests)
 ...
 Test Files  44 passed (44)
      Tests  571 passed (571)
   Duration  15.42s
```

### Note on Integration Tiers (Work Order §112)
`api-integration` and `env-validation` with live Supabase instances execute exclusively in GitHub Actions CI (`.github/workflows/test.yml`), where remote secrets and service-role tokens are provisioned. Local execution ran all unit, property, invariant, and typecheck suites. No unverified claim of local remote integration execution is made.
