# Audit: m1/variants-ledger
Spec: `docs/tasks/warehouse-m1-variants-ledger.md`   Reviewed: 398dbe5afea850523a808d73f7b5530969579440   Date: 2026-11-03

## Verdict
FIX — The ledger and its database-level enforcement are sound. Five issues need fixing before merge; two are major (a race condition that silently corrupts the target quantity, and an unauthenticated endpoint that exposes inventory data), the rest are minor.

## Findings

### 1. PATCH /admin/products/:id/stock has a read-then-compute TOCTOU race  [severity: major]
- Where: `artifacts/api-server/src/routes/admin/products.ts`:199-222
- Failing scenario: Admin A wants to set variant stock to 30. At the same instant, a customer order decrements stock by 2 via `decrement_stock_safe`. The interleave:
  1. Admin A reads `on_hand = 20` (line 200-204)
  2. Customer order decrements stock: `on_hand` becomes 18
  3. Admin A computes `delta = 30 − 20 = +10` (line 211)
  4. Admin A inserts a movement with `delta = +10`; trigger applies it: `on_hand` becomes 28, not the intended 30.
  No error is raised; the admin sees `{ success: true, stock: 30 }` in the response (line 229 returns the *requested* value, not the actual result), so the mistake is invisible.
- Invariant violated: "Quantity and the sum of movements must never be able to disagree" — the response lies about the actual quantity. Spec §1: the read-modify-write pattern on `orders.ts ~line 92` is called out as the exact defect M1 exists to fix; this endpoint re-introduces the same structure.
- Fix direction (not prescriptive): either make the endpoint accept a delta directly, or run the read + compute + insert inside a single Postgres function that locks the variant row (`SELECT ... FOR UPDATE`) within the same transaction.

### 2. GET /inventory/scan/:barcode is unauthenticated  [severity: major]
- Where: `artifacts/api-server/src/routes/inventory.ts`:42
- Failing scenario: Any anonymous HTTP client sends `GET /api/inventory/scan/4006381333931` and receives the variant's `on_hand`, `price`, product title, slug, and image. No token is required. An attacker or competitor can enumerate all barcodes and extract the shop's full inventory levels, pricing, and product catalog.
- Invariant violated: Spec §3 "Role defaults" — staff may see stock, the public should not. The barcode scan is an operational tool for the shop floor, not a storefront feature.
- Fix direction: add `requireStaffOrAdmin` middleware to this route.

### 3. Movement history endpoint leaks `unit_cost` to staff role  [severity: minor]
- Where: `artifacts/api-server/src/routes/inventory.ts`:100-111
- Failing scenario: A staff user calls `GET /api/admin/variants/:id/movements`. The response includes `unit_cost` on every movement row. The spec says "Owner sees cost and margin; staff do not" (§3 Role defaults). A staff member can see every incoming goods receipt's unit cost and compute margin from the selling price.
- Invariant violated: Spec §3 "Owner sees cost and margin; staff do not."
- Fix direction: strip `unit_cost` from the response when `(req as any).userRole === 'staff'`, or use a conditional select.

### 4. POST /admin/stock/adjust allows staff to set any reason including `opening_balance`  [severity: minor]
- Where: `artifacts/api-server/src/routes/inventory.ts`:227-233
- Failing scenario: A staff user sends `POST /admin/stock/adjust` with `reason: "opening_balance"` and `quantity_delta: 500`. The endpoint allows it because `opening_balance` is in the `VALID_REASONS` list. Staff can inject arbitrary opening balances, making the ledger meaningless for theft detection — the exact pain point the customer named (spec §2).
- Invariant violated: Spec §3 "Staff may sell and adjust stock with a reason; staff may not change prices or delete history." Opening balances are an admin-only administrative action, not a stock adjustment.
- Fix direction: restrict `opening_balance` to admin role at the API level.

### 5. `variant_costs` row not created on product update when price/sku synced to default variant  [severity: minor]
- Where: `artifacts/api-server/src/routes/admin/products.ts`:158-163
- Failing scenario: An admin creates a product via `POST /admin/products` (which correctly creates a `variant_costs` row). Later, an admin *updates* the product via `PATCH /admin/products/:id` and changes the price. The code syncs `price` to the default variant (line 162), but if the `variant_costs` row was deleted for any reason (e.g., a cascade from a variant deletion/recreation), the endpoint never re-creates it. This is a resilience issue, not a data-loss bug under normal operation — but the create-variant flow at `POST /admin/products/:id/variants` always creates one, and this flow does not. Inconsistency in the write path.
- Invariant violated: Consistency between variant and variant_costs lifecycle.

## Checked and found sound

1. **Ledger-quantity atomicity.** Every quantity change goes through a `stock_movements` INSERT, which fires the `AFTER INSERT` trigger `trg_apply_stock_movement`. The trigger atomically updates `on_hand` and rejects if the result would go negative. The movement INSERT and the `on_hand` UPDATE happen within the same database transaction (trigger execution is transactional in Postgres). If the process dies mid-transaction, both the movement and the quantity change roll back together. Verified in:
   - Migration lines 214-238 (trigger definition)
   - `decrement_stock_safe` / `increment_stock` RPCs (lines 290-341): both INSERT into `stock_movements`, never directly modify `on_hand`
   - `POST /admin/stock/adjust` (inventory.ts:218-261): INSERTs into `stock_movements`
   - `POST /admin/products` (products.ts:88-97): opening balance via movement
   - `POST /admin/products/:id/variants` (inventory.ts:173-184): opening balance via movement
   - `POST /orders` (orders.ts:111-124): decrements via `decrementStockSafe` which calls the RPC

2. **Direct on_hand update guard.** The `trg_guard_variant_on_hand_update` trigger (migration lines 74-87) prevents any direct `UPDATE` of `on_hand` unless called from within a trigger (pg_trigger_depth > 1). This is the correct pairing: the apply-movement trigger runs at depth ≥ 2, so it passes; any external `UPDATE` runs at depth 1 and is rejected with SQLSTATE 55000.

3. **Concurrency / atomic decrements.** The `trg_apply_stock_movement` trigger uses `UPDATE ... WHERE (on_hand + NEW.quantity_delta) >= 0`. This is an atomic compare-and-set at the row level. Two simultaneous decrements of the last unit: the first one succeeds and the second gets `NOT FOUND` (because the WHERE clause fails after the first transaction commits), raising ST001. The original `decrement_stock_safe` semantics are preserved, and the read-modify-write is eliminated. Verified the property test at `variants-ledger.property.test.ts` Property 4 tests this with interleaved concurrent operations.

4. **Reservations are not movements.** Searched the entire diff for any reservation-related code in the movement schema. The `stock_movement_reason` enum contains no reservation-related values. No table or column named `reservation` was introduced. The spec's M2 reservation design is explicitly mentioned as future work. No violation of "Reservations are not movements" invariant.

5. **RLS on all new tables.** Every new table has RLS enabled with explicit policies:
   - `product_variants`: public read, admin write (FOR ALL), staff insert, staff update
   - `variant_costs`: admin-only read and write (no staff or public access)
   - `stock_movements`: staff/admin read, staff/admin insert, immutable (no update/delete via trigger)
   - `product_option_types`: public read, admin/staff write
   - `product_option_values`: public read, admin/staff write
   - `variant_option_values`: public read, admin/staff write

6. **Tenant isolation is consistent with existing schema.** The existing codebase uses no `tenant_id` or `store_id` column anywhere. Existing tables (`products`, `categories`, `orders`) use the same role-based RLS pattern without tenant scoping. The new tables follow the same convention. This is not a gap introduced by M1 — it is the pre-existing architecture.

7. **Migration correctness — both paths.**
   - *Existing rows:* The DO block (migration lines 240-268) iterates all products, creates a default variant for each with `on_hand = 0`, then INSERTs an `opening_balance` movement if `stock > 0`. The movement trigger fires and sets `on_hand` to the correct value. `cart_items` and `order_items` are backfilled with `variant_id` pointing to the default variant.
   - *Empty database:* All statements use `IF NOT EXISTS` / `IF NOT EXISTS` guards and the DO block simply finds no products to iterate. Clean.
   - *Edge: `stock = 0` products:* The migration correctly skips the opening-balance movement (line 258: `IF r.stock > 0`), leaving `on_hand` at 0 with an empty ledger. Sum of movements = 0 = on_hand. Correct.

8. **Silenced tests.** Diffed every test file. The `stock-model.ts` helper was extended (not reduced) — old `decrement` method preserved for backwards compatibility. `orders.test.ts` was updated to use `increment_stock` RPC instead of direct `UPDATE products SET stock`, which is the correct migration to the new architecture. No test was deleted, skipped, or had an assertion loosened.

9. **Staff price mutation guard.** Two layers:
   - API layer: `PATCH /admin/variants/:id` checks `userRole === 'staff'` and returns 403 if price is in the body (inventory.ts:198-200).
   - Database layer: `trg_guard_staff_price_update` trigger fires on `UPDATE OF price` and raises 42501 if the acting user is staff (migration lines 57-71). Defense in depth.

10. **Barcode uniqueness.** Partial unique index `idx_variants_barcode` on `product_variants(barcode) WHERE barcode IS NOT NULL` (migration line 37-38). Correct: allows multiple NULL barcodes but enforces uniqueness on non-NULL values.

## Checks run
typecheck: **PASS** (exit 0)   tests: **516 passed / 101 suites failed** (all failures are `api-integration` tests requiring Supabase credentials, expected per AGENTS.md §4 — "The api-integration and env-validation projects need Supabase credentials and a running API server; they run in CI")   audit:invariants:strict: **PASS** (exit 0, all 5 invariant checks green, 0 violations)
