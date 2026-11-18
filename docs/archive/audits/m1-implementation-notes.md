# Phase M1 — Implementation Notes

**Date:** 2026-11-03  
**Branch:** `m1/variants-ledger`  
**Spec:** `docs/tasks/warehouse-m1-variants-ledger.md`  
**Review Reference:** `docs/audits/m1-design-note-review.md`  

---

## 1. Overview & Architectural Decisions

Phase M1 introduces the product variant layer, immutable stock movement ledger, and staff role enforcement to eliminate split-brain inventory anomalies and establish an auditable supply-chain foundation.

### Key Architectural Resolutions (from Review B1–B3 & M1)
1. **Admin-Only Margin Secrecy (B1):** Cost prices are stored in a dedicated `public.variant_costs` table with RLS restricting access exclusively to `admin`. Public catalog queries and staff users cannot read cost data or margins.
2. **Custom SQLSTATEs for Domain Errors (B2):** The ledger trigger `trg_apply_stock_movement` raises distinct SQLSTATE codes in unassigned class `ST`:
   - `ST001`: Insufficient stock on hand (`quantity_delta` exceeds `on_hand`).
   - `ST002`: Variant not found.
   Generic `P0001`/`P0002` codes were avoided to keep application domain errors distinct from Postgres internal exceptions.
3. **Single Write Path Enforcement (B3):** `product_variants.on_hand` is guarded by trigger `trg_guard_variant_on_hand_update`. Direct updates with `pg_trigger_depth() <= 1` raise SQLSTATE `55000` (object not in prerequisite state). All stock mutations must occur via `stock_movements`.
4. **Row Lock Semantics (M1):** The pairing trigger performs an atomic `UPDATE product_variants SET on_hand = on_hand + NEW.quantity_delta WHERE id = NEW.variant_id AND (on_hand + NEW.quantity_delta) >= 0 RETURNING on_hand`. Postgres acquires an exclusive row lock on the variant row and evaluates the predicate under lock, preventing read-modify-write races without needing an explicit `SELECT ... FOR UPDATE`.
5. **Staff Role Price Protection:** The `trg_guard_staff_price_update` trigger enforces that users with role `staff` cannot update `product_variants.price` (SQLSTATE `42501`).

---

## 2. Changes by Phase

### Phase A — Schema, DDL, RLS, and Types
- **Migration:** Created `supabase/migrations/20261102100000_m1_variants_ledger.sql` and updated `supabase/schema.sql`.
- **User Roles:** Expanded `users_role_check` constraint to `('customer', 'staff', 'admin')`.
- **Product Variants:** Added `public.product_variants` table with indexes (`idx_product_variants_single_default`, `idx_variants_barcode`, `idx_product_variants_product_id_sort`) and RLS policies.
- **Normalized Options:** Created `public.product_option_types`, `public.product_option_values`, and `public.variant_option_values` with RLS.
- **Stock Movements Ledger:** Created enum `stock_movement_reason` (including forward-compatible M3 assembly reasons `assembly_consume`, `assembly_produce`) and append-only table `public.stock_movements`. Added append-only trigger `trg_stock_movements_immutable` (`2BP01`).
- **Data Backfill:** Automatically created default variants and `opening_balance` ledger movements for all existing catalog products.
- **Line Item Snapshots:** Added `variant_id`, `variant_title_snapshot`, and `sku_snapshot` to `order_items` and `cart_items`.
- **RPC Functions:** Rewrote `decrement_stock_safe` and `increment_stock` to write to `stock_movements`.
- **Generated Types:** Synchronized `artifacts/supabase-types/src/database.types.ts` and OpenAPI spec hooks.

### Phase B — Route & Direct Write Remediation
- **Audit Baseline:** Remediated all 6 legacy direct stock updates across API routes and test fixtures. Updated `scripts/audit/baseline.json` to 0 known violations.
- **Product Endpoints (`artifacts/api-server/src/routes/admin/products.ts`):**
  - `POST /admin/products`: Atomically creates product, default variant, cost entry, and initial `opening_balance` movement if initial stock > 0.
  - `PATCH /admin/products/:id`: Ignores direct `stock` mutations, updates default variant metadata.
  - `PATCH /admin/products/:id/stock`: Routes through `stock_movements` ledger with reason and actor tracking.
  - `POST /admin/products/:id/duplicate`: Duplicates product and seeds an initial default variant.
- **Order Endpoints:** Updated `artifacts/api-server/src/routes/orders.ts` and `admin/orders.ts` to mutate stock via RPC and record variant snapshot data.
- **Inventory Router (`artifacts/api-server/src/routes/inventory.ts`):** Mounted `/api/inventory/scan/:barcode`, `/api/admin/variants/:id/movements`, variant management, and `/api/admin/stock/adjust`.

### Phase C — Storefront & Admin UI
- **StockCell (`artifacts/store/src/components/admin/StockCell.tsx`):** Added inline stock adjustment modal with mandatory movement reason dropdown (`manual_adjustment`, `stocktake_correction`, `damage_write_off`, etc.).
- **VariantMovementHistoryModal (`artifacts/store/src/components/admin/VariantMovementHistoryModal.tsx`):** Displays immutable audit trail for variant movements (timestamp, reason badge, delta, actor, reference, note).
- **ProductVariantManager (`artifacts/store/src/components/admin/ProductVariantManager.tsx`):** Option & variant editor integrated into `ProductFormPage.tsx` with price, barcode, SKU, and unit of measure controls (cost price hidden from non-admin).

### Phase D — Tests & Model Verification
- **Stock Model (`artifacts/api-server/tests/helpers/stock-model.ts`):** Extended with movement ledger tracking, `ST001` error handling, `55000` direct write rejection, and ledger sum invariant checking.
- **Property Suite (`artifacts/api-server/tests/variants-ledger.property.test.ts`):**
  - Property 1: $\sum(\text{deltas}) \equiv \text{on\_hand}$ across arbitrary operations.
  - Property 2: Insufficient stock raises `ST001`.
  - Property 3: Direct `on_hand` mutation throws `55000`.
  - Property 4: Concurrent interleaved transactions preserve non-negative stock and ledger consistency.
- **Security & RLS Suite (`artifacts/api-server/tests/variants-ledger-rls.test.ts`):**
  - Verifies RLS policies and trigger definitions in migration SQL.
  - Verifies API route authorization (admin full access, staff price change block 403, customer/anon rejection 401/403).

---

## 3. Verification Commands & Results

| Check | Command | Local Result |
| :--- | :--- | :--- |
| **TypeScript Typecheck** | `pnpm run typecheck` | Passed cleanly (0 errors across 5 projects) |
| **Unit Test Suite** | `pnpm run test:unit` | Passed cleanly (31 files, 516 passed) |
| **Architectural Invariants** | `pnpm run audit:invariants:strict` | Passed cleanly (0 violations, baseline empty) |
| **Variant Ledger Property Tests** | Vitest `variants-ledger.property.test.ts` | Passed cleanly (4 properties, 30–100 runs each) |
| **Variant Ledger RLS Tests** | Vitest `variants-ledger-rls.test.ts` | Passed cleanly (10 tests) |

> [!NOTE]
> Per `AGENTS.md`, full database-backed integration suites (`api-integration`) run in CI (`.github/workflows/test.yml`) where Supabase service credentials are provisioned. The property and structural RLS suites were validated locally in isolation.
