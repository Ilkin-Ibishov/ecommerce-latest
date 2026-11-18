# M1 Schema Additions Notes & Verification

Branch: `m1/variants-ledger`  
Task: `prompts/m1-schema-additions.md`  
Date: 2026-11-03  

---

## 1. Executive Summary & Purpose

The stock movement ledger is initially empty; adding non-backfill-sensitive and backfill-sensitive columns now costs only a column addition. If deferred until after real movements are written, historical records can never be accurately assigned business dates, transaction groupings, compensating reversal links, or case packaging quantities.

All additions in this phase are additive and preserve existing behavior while laying the necessary structural foundations for Milestone 2 inventory costing, reconciliation, and packaging scans.

---

## 2. Item-by-Item Breakdown of Changes

### A1 — `posting_date` on `stock_movements` [Critical]
- **Problem**: Quantity is order-independent (`SUM(quantity_delta)` commutes), making an `AFTER INSERT` trigger safe regardless of write order. In contrast, weighted average cost and FIFO valuation do **not** commute. A receipt entered on Thursday with an actual supplier delivery date of Monday changes the running valuation that every sale between Monday and Thursday should have consumed. Without a business date distinct from `created_at`, replaying inventory valuation in historical order is impossible.
- **Implementation**:
  - Migration `supabase/migrations/20261103210000_m1_schema_additions.sql` adds:
    ```sql
    ALTER TABLE public.stock_movements
      ADD COLUMN IF NOT EXISTS posting_date timestamptz NOT NULL DEFAULT now();
    ```
  - Added replay and timeline indexes:
    - `idx_stock_movements_variant_posting_date ON public.stock_movements(variant_id, posting_date DESC)`
    - `idx_stock_movements_posting_date ON public.stock_movements(posting_date DESC)`
  - Updated API route `POST /admin/stock/adjust` to accept and persist `posting_date`.
  - Updated `GET /admin/variants/:id/movements` to select `posting_date` and order by `posting_date DESC, created_at DESC`.
  - **M2 Architectural Directive**: Placed an explicit comment next to `trg_apply_stock_movement` in both migration and canonical `schema.sql` forbidding the extension of the `AFTER INSERT` trigger for cost calculations. Cost valuation belongs in a replay projection keyed on `posting_date`.

---

### A2 — Grouping and Reversal Keys on `stock_movements`
- **Problem**: In an append-only ledger, corrections are compensating rows. Without a link, a reversal is indistinguishable from an arbitrary adjustment. Furthermore, compound operations (e.g., multi-line sales, kit assemblies, stocktake counts) produce multiple movement rows with no mechanism to query "all movements belonging to this single operation".
- **Implementation**:
  - Added `transaction_id uuid` and `correlation_id uuid` to `public.stock_movements`.
  - Added partial indexes:
    - `CREATE INDEX idx_stock_movements_transaction_id ON public.stock_movements(transaction_id) WHERE transaction_id IS NOT NULL;`
    - `CREATE INDEX idx_stock_movements_correlation_id ON public.stock_movements(correlation_id) WHERE correlation_id IS NOT NULL;`
  - Updated `POST /admin/stock/adjust` to accept `transaction_id` and `correlation_id`.
  - Updated `GET /admin/variants/:id/movements` to return `transaction_id` and `correlation_id`.

---

### A3 — Pack Quantity on `variant_barcodes` Row
- **Problem**: An outer shipping case carries a distinct barcode from an individual retail piece. Without pack quantities attached to the barcode row, receiving a case of 12 requires staff to perform mental arithmetic at the receiving counter.
- **Implementation**:
  - Added columns to `public.variant_barcodes`:
    ```sql
    ALTER TABLE public.variant_barcodes
      ADD COLUMN IF NOT EXISTS pack_quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (pack_quantity > 0);
    ALTER TABLE public.variant_barcodes
      ADD COLUMN IF NOT EXISTS pack_unit text NOT NULL DEFAULT 'pcs';
    ```
  - Updated `GET /inventory/scan/:barcode` to return `pack_quantity` and `pack_unit` in `VariantScanDetail`.
  - Updated `openapi.yaml` and regenerated Orval/Zod schemas.
  - Updated `POST /admin/stock/adjust`: when a barcode is provided, the endpoint resolves the barcode's `pack_quantity`. A single scan of a 12-pack code creates a movement with `quantity_delta = 12`, not 1.

---

### A4 — Catalog Tracking and Threshold Fields on `product_variants`
- **Problem**: Services, made-to-order items, and consumables are sold without physical inventory tracking. Furthermore, merchant low-stock alert thresholds must accumulate prior to the M6 alerting engine.
- **Implementation**:
  - Added columns to `public.product_variants`:
    ```sql
    ALTER TABLE public.product_variants
      ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;
    ALTER TABLE public.product_variants
      ADD COLUMN IF NOT EXISTS low_stock_threshold numeric(12,3) CHECK (low_stock_threshold >= 0);
    ```
  - Updated `GET /admin/products/:id/variants` and `POST /admin/products/:id/variants` / `PATCH /admin/variants/:id` to select and manage `track_stock` and `low_stock_threshold`.
  - Updated `POST /admin/products` to initialize default variants with these fields.

---

## 3. Architectural Decisions, Disagreements & Trade-Offs

1. **Populated Database Backfill Trap (Disagreement with initial naive SQL):**
   - In PostgreSQL, running `ALTER TABLE public.stock_movements ADD COLUMN posting_date timestamptz NOT NULL DEFAULT now();` immediately populates existing rows with the execution timestamp `now()`.
   - A subsequent `UPDATE ... WHERE posting_date IS NULL` would find zero rows, leaving pre-existing movements stamped with the migration time rather than their historical transaction time.
   - We implemented an unconditional backfill `UPDATE public.stock_movements SET posting_date = created_at;`, verified by `m1-schema-additions-migration.test.ts`.
2. **Pack Quantity Placement on Barcode vs Separate Packaging Entity:**
   - Grocy and ERPNext attach packaging and quantities directly to barcode child rows (`Item Barcode` / `product_barcodes`). Odoo uses a separate `product.packaging` table.
   - For our target segment (retail shops with hundreds of SKUs), placing `pack_quantity` and `pack_unit` directly on `variant_barcodes` avoids relational overhead and enables single-query resolution during counter scans.
3. **Trigger Invariant Preservation:**
   - As mandated, `trg_apply_stock_movement` remains strictly limited to atomic `on_hand` adjustment and non-negative bounds checking. Running cost valuation remains deferred to an ordered replay projection.

---

## 4. Carried-Forward M2 Roadmap (Not Backfill-Sensitive)

As instructed by `prompts/m1-schema-additions.md` and recorded in `docs/design-notes/m1-variants-ledger.md`, the following non-backfill-sensitive items are deferred to M2:
1. **`rebuild_on_hand(variant)` and `verify_stock_integrity()`**: On-demand / scheduled ledger-to-cache reconciliation tool.
2. **Stocktake Optimistic Concurrency**: Three-way snapshot check `{variant_id, counted_qty, observed_on_hand}` to prevent lost updates during delayed physical counts.
3. **`allow_negative_stock` Setting**: Tenant configuration override for retail operational workflows with movement note audits.
4. **Unit-of-Measure Immutability**: Database trigger preventing modification of `unit_of_measure` once movements exist.

---

## 5. Verification Results & Real Command Outputs

### 5.1 Typecheck
Command: `pnpm run typecheck`
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

### 5.2 Architectural Invariants (Strict)
Command: `pnpm run audit:invariants:strict`
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

### 5.3 Unit Tests (Store Unit & Environment Validation)
Command: `pnpm run test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  store-unit  src/__tests__/heading-hierarchy.property.test.ts (8 tests)
 ✓  store-unit  src/__tests__/cart-validation.test.ts (25 tests)
 ✓  store-unit  src/__tests__/m1-schema-additions-migration.test.ts (4 tests)
 ✓  store-unit  src/__tests__/barcode-pack-quantity.test.ts (4 tests)
 ✓  store-unit  src/__tests__/barcode-matrix-resolution.test.ts (4 tests)
 ✓  store-unit  src/__tests__/stock-adjust-race.test.ts (2 tests)
 ✓  store-unit  src/__tests__/adjustment-role-guards.test.ts (4 tests)
 ✓  store-unit  src/__tests__/unit-cost-privacy.test.ts (3 tests)
 ✓  store-unit  src/__tests__/variant-costs-lifecycle.test.ts (5 tests)
 ✓  store-unit  src/__tests__/inventory-auth.test.ts (4 tests)
 ...
 Test Files  39 passed (39)
      Tests  546 passed (546)
   Duration  5.09s
```

### 5.4 API Route & Migration Integration Tests
Command: `vitest run artifacts/api-server/tests/variants-ledger-rls.test.ts`
```
 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  api-integration  tests/variants-ledger-rls.test.ts (24 tests) 65ms

 Test Files  1 passed (1)
      Tests  24 passed (24)
   Duration  666ms
```
Including:
- `A1: adds posting_date to stock_movements with indexes and M2 trigger warning` (passed)
- `A2: adds transaction_id and correlation_id to stock_movements with indexes` (passed)
- `A3: adds pack_quantity and pack_unit to variant_barcodes` (passed)
- `A4: adds track_stock and low_stock_threshold to product_variants` (passed)
- `A3: scan of barcode with pack_quantity 12 produces movement of 12, not 1` (passed)
- `A1 & A2: records posting_date, transaction_id, and correlation_id on stock movement` (passed)

### 5.5 Property Tests (Concurrent Race & Atomicity)
Command: `vitest run artifacts/api-server/tests/variants-ledger.property.test.ts`
```
 ✓  api-integration  tests/variants-ledger.property.test.ts (5 tests) 9095ms
   ✓ Property 4: Concurrent transactions preserve non-negative invariant and ledger consistency
   ✓ Property 5 (F1 Regression): Interleaved target adjustment with concurrent decrement asserts actual quantity
```
