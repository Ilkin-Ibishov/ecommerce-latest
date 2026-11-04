# Audit: m2/receiving-cost
Spec: `docs/tasks/warehouse-m2a-receiving-cost.md`   Reviewed: b7c6a13c   Date: 2026-11-04

## Verdict
**FIX** — One blocker prevents every new RPC from executing through the Express API; two major findings affect correctness of the margin report and the `allow_negative_stock` setting.

## Findings

### 1. Every SECURITY DEFINER RPC fails when called through the Express API  [severity: blocker]
- Where: `supabase/migrations/20261104110000_m2a_functions_triggers.sql` lines 60, 106, 278, 484, 576, 663
- Failing scenario: Admin logs in, creates a receipt with lines and costs, clicks Post. Express `requireAdmin` middleware validates the JWT, confirms `role = 'admin'`, and calls the RPC via `getAdminSupabase()` — the **service role client**. Inside `post_goods_receipt` (and every other new function), the first thing that executes is:
  ```sql
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: …' USING ERRCODE = '42501';
  END IF;
  ```
  `is_admin()` calls `auth.uid()`. With the service role client there is no JWT, so `auth.uid()` returns NULL, `is_admin()` returns false, and the function unconditionally raises. The same failure path applies to `reverse_goods_receipt`, `rebuild_on_hand`, `verify_stock_integrity`, `recompute_variant_cost`, and `get_margin_report`.

  The existing M1 RPCs (`decrement_stock_safe`, `increment_stock`, `set_product_stock_safe`) do **not** have this guard — they run as plain `plpgsql` and rely on RLS or the caller's session. The new functions add `SECURITY DEFINER` (correct, needed to bypass RLS on admin-only cost tables) plus a manual `is_admin()` check that is incompatible with the service role client the Express API always uses.
- Invariant or spec clause violated: Spec §12 deliverable 4 ("API routes: receipt draft/post/reverse, suppliers CRUD, margin report") — these routes exist but cannot succeed at runtime.

### 2. `allow_negative_stock` setting is added but never consulted  [severity: major]
- Where: `supabase/migrations/20261104100000_m2a_schema_tables.sql` line 253 (adds the column); `supabase/schema.sql` line 494–513 (`trg_apply_stock_movement`)
- Failing scenario: Admin enables `allow_negative_stock` in site settings (sets it to true). Staff sells 1 unit of a variant with 0 on-hand. The AFTER INSERT trigger `trg_apply_stock_movement` evaluates `WHERE (on_hand + NEW.quantity_delta) >= 0`, finds no matching row, and raises `'Insufficient stock for variant %'`. The setting is inert — the trigger never reads it.
- Invariant or spec clause violated: Spec §10 item 4: "`allow_negative_stock` as a tenant setting, default off, each override recorded on the movement. Needed before the counter can sell."

### 3. Margin report shows zero revenue for counter sales entered via stock adjustment  [severity: major]
- Where: `supabase/migrations/20261104110000_m2a_functions_triggers.sql` lines 696–714 (`movement_revenue` CTE); `artifacts/api-server/src/routes/inventory.ts` line 406
- Failing scenario: The margin report joins movements to `order_items` via `reference_id::uuid = ovup.order_id`. It only computes revenue when `reference_type = 'order'`. But a stock movement created through the `/admin/stock/adjust` endpoint with reason `counter_sale` is inserted with `reference_type = 'manual'` (hardcoded at line 406 of `inventory.ts`), not `reference_type = 'order'`. The LEFT JOIN to `order_variant_unit_prices` produces NULL, and the CASE expression defaults to 0 revenue.

  **Concrete sequence:** Staff scans a barcode and creates a manual adjustment: `{ reason: "counter_sale", quantity_delta: -5, variant_id: "v1" }`. Movement is inserted with `reference_type = 'manual'`. Owner opens the margin report for the period. The report counts COGS of 5 × avg_cost (positive) but zero revenue. The variant appears to be losing money on sales it actually earned revenue from. In a 50–100 sales/day shop where many counter sales go through the adjust endpoint before the counter UI ships, this will systematically understate revenue and show phantom losses.
- Invariant or spec clause violated: Spec §9: "Per variant and per category: units sold, revenue, COGS, gross margin, margin percent." Revenue must include all sales. A counter sale that doesn't link an order silently zeroes its revenue while its COGS is still counted.

### 4. Reversal after real consumption can leave a wrong weighted average  [severity: major]
- Where: `supabase/migrations/20261104110000_m2a_functions_triggers.sql` lines 600–641 (`reverse_goods_receipt`)
- Failing scenario:
  1. Receive 10 units @ $5 (avg = $5, qty = 10)
  2. Sell 8 units (avg = $5, qty = 2)
  3. Reverse the receipt → inserts −10 `return_to_supplier` at `posting_date` of original receipt
  4. Recompute from the receipt's `posting_date` forward

  After reversal, the movements replayed from the receipt date are: +10 receipt @ $5, −8 sale @ avg, −10 reversal @ avg. The sale consumed at $5, the reversal at $5. Running quantity = 10 − 8 − 10 = −8.

  But `allow_negative_stock` is off and `trg_apply_stock_movement` enforces `(on_hand + qty_delta) >= 0`. The reversal movement tries to insert `quantity_delta = -10` when on_hand is 2. The trigger fires and raises `'Insufficient stock for variant'`. The entire `reverse_goods_receipt` transaction rolls back.

  This is *arguably correct* behaviour — you can't reverse a receipt whose goods have been sold. But the spec §5 says "a reversed receipt must leave on-hand and valuation exactly as if it had never been posted — except where real sales consumed the goods in between." The "except" clause implies reversal should succeed even when partial consumption occurred, leaving on-hand at the new correct level. The implementation blocks it entirely.

  The owner's workaround is to first adjust stock upward by 8 (manual adjustment), then reverse, then sell 8 again — a three-step dance that defeats the purpose of the reversal feature.
- Invariant or spec clause violated: Spec §5 (prompt §5): "A reversed receipt must leave on-hand and valuation exactly as if it had never been posted — except where real sales consumed the goods in between."

### 5. Concurrent receipt posting is guarded by SELECT … FOR UPDATE, but concurrent cost recompute uses advisory locks on a text hash  [severity: minor]
- Where: `supabase/migrations/20261104110000_m2a_functions_triggers.sql` line 291 (`pg_advisory_xact_lock(hashtext('cost_replay_' || p_variant_id::text))`)
- Failing scenario: `hashtext` returns a 32-bit integer. Two distinct variant UUIDs could hash-collide, causing one variant's recompute to wait on an unrelated variant's lock. With 500 variants this is astronomically unlikely (birthday bound ~250K before 50% collision probability). Not a correctness bug but an unnecessary risk when `p_variant_id::uuid` could be cast to two `int` arguments of `pg_advisory_xact_lock(bigint)` for a collision-free lock.
- Practical impact: negligible at 500 variants. Theoretical only.

### 6. `rebuild_on_hand` does not recompute the cost projection  [severity: minor]
- Where: `supabase/migrations/20261104110000_m2a_functions_triggers.sql` lines 49–91
- Failing scenario: A corruption event desynchronises `on_hand` from the ledger sum. Admin calls `rebuild_on_hand(variant_id)`. The function repairs `on_hand` but does not call `recompute_variant_cost`. If the cost projection's `running_quantity` has also drifted (e.g., because a movement was somehow lost from the projection), `verify_stock_integrity` will still report `projection_vs_ledger` divergence after the repair. The owner must know to also trigger a cost recompute manually.
- This is defensible as a design choice (repair one thing at a time), but the function's name and return type suggest completeness. A comment or doc would help.

### 7. Staff can call `rebuild_on_hand` and `verify_stock_integrity` via PostgREST RPC if not restricted by RLS  [severity: minor]
- Where: `supabase/migrations/20261104110000_m2a_functions_triggers.sql` lines 55, 104
- Failing scenario: Both functions are `SECURITY DEFINER` and check `is_admin()` internally. A staff token calling `supabase.rpc('rebuild_on_hand', ...)` directly through PostgREST will reach the function body (PostgREST grants `EXECUTE` on public functions to `authenticated` by default). The `is_admin()` check correctly blocks staff. **However**, this relies on the `is_admin()` check that Finding #1 shows is broken for the service role path. For a *staff JWT* (where `auth.uid()` returns the staff user's ID and `is_admin()` correctly returns false), the guard does work. So this is not a leak — staff are blocked. The concern is that the protection depends on application-layer logic inside the function rather than on Postgres `REVOKE EXECUTE`.
- Invariant or spec clause violated: Spec §10: "repair function is owner-only." The enforcement is correct for direct PostgREST calls with a staff JWT but relies on code in the function body rather than Postgres role permissions.

## Checked and found sound

1. **Cost isolation from staff tokens.** The design is excellent: cost data lives in separate admin-only tables (`goods_receipt_line_costs`, `goods_receipt_costs`, `stock_movement_costs`), the `unit_cost` column was dropped from `stock_movements`, and the invariant check `no-cost-column-on-staff-tables` enforces this mechanically. Staff-accessible tables (`goods_receipts`, `goods_receipt_lines`, `suppliers`) carry zero cost columns. A staff token querying PostgREST directly sees no cost data by any path. The Express API routes conditionally include cost fields only for `userRole === "admin"`. This is the strongest cost boundary I've seen — defence in depth across schema, RLS, and application layer.

2. **Ledger immutability.** `stock_movements` remains append-only via `trg_stock_movements_immutable` (BEFORE UPDATE OR DELETE). The cost projection in `stock_movement_costs` is correctly separate — it can be deleted and rebuilt without touching the ledger. Movements inserted by `post_goods_receipt` carry the receipt's `posting_date` and a shared `transaction_id`.

3. **Atomic posting.** `post_goods_receipt` runs in a single transaction: it locks the receipt with `FOR UPDATE`, verifies status = 'draft', verifies all lines have costs, bulk-inserts movements, recomputes costs, and updates status — all or nothing. A constraint violation on any movement (e.g., variant not found, insufficient stock) rolls back the entire transaction. The all-lines-or-none guarantee holds.

4. **Double-post prevention.** The `FOR UPDATE` lock on the receipt row prevents concurrent posts. The status check `IF v_receipt.status <> 'draft'` after the lock means the second concurrent caller will see 'posted' and raise an exception. The idempotent-rejection pattern is correct.

5. **Opening balance without cost excluded from average.** The replay engine correctly enters the `opening_balance` branch (line 377), checks `v_opening_cost IS NOT NULL AND v_opening_cost > 0`, and when false, sets `unit_cost = 0`, `total_cost = 0`, does not add to `v_basis_qty`, and sets `has_unknown_cost_basis = true`. The quantity is added to `v_qty` (correctly — the units exist physically) but the average is untouched. The TypeScript test (`costing-engine-replay.property.test.ts` line 225–246) verifies this independently.

6. **Deterministic replay order.** Both the SQL engine (`ORDER BY sm.posting_date ASC, sm.created_at ASC, sm.id ASC`) and the TypeScript engine use the same three-key sort. The `id` (UUID) tiebreaker is deterministic and immutable. The `idx_smc_replay_order` index covers this.

7. **Reversal correctness.** `reverse_goods_receipt` inserts compensating movements with negated `quantity_delta`, reason `return_to_supplier`, the original receipt's `posting_date`, and `correlation_id` pointing to the original transaction. Recompute is called from `posting_date` forward, so the reversed movements enter the weighted average and correctly undo the original receipt's impact.

8. **Reservations.** No table, column, movement type, or query in this branch implies reservations. The `reservations-are-not-movements` invariant check passes. Clean.

9. **UoM immutability.** `trg_guard_variant_uom_immutable` correctly prevents changing `unit_of_measure` once any `stock_movements` row exists for that variant. The trigger fires only `BEFORE UPDATE OF unit_of_measure`, so updates to other columns are unaffected.

10. **Margin report fan-out prevention.** The `order_variant_unit_prices` CTE pre-aggregates `order_items` by `(order_id, variant_id)` before joining to movements. Two `order_items` rows for the same variant in one order produce one weighted unit price, not a Cartesian product. The unit test (`margin-report-granularity.test.ts`) verifies this.

11. **Migration on empty database.** The backfill migration (`20261104120000_m2a_cost_backfill.sql`) iterates distinct `variant_id` from `stock_movements`. On an empty database, this iterates zero rows and is a no-op. The schema tables migration is all `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` — idempotent. Both paths are safe.

12. **Silenced tests.** All test files in the diff are new (100% additions). No existing test was deleted, skipped, given a looser assertion, or had its run count lowered. The pre-existing `storefront-ux.property.test.ts` Property 3 timeout (noted in the prompt as known-flaky) was not touched by this branch. 571 tests pass.

13. **Generated code.** The generated files (`lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`) changed in commit `58472a9` alongside the `openapi.yaml` spec change. No generated file was modified in any other commit. No hand-editing of generated code.

14. **`set_product_stock_safe` parameter name.** The M2a migration creates `set_variant_stock_safe` with the correct parameter name `p_variant_id`, and wraps `set_product_stock_safe` as a backward-compatible alias that delegates to it. The parameter name on the alias still says `p_product_id` (intentional — it accepts either), and the function body tries variant lookup first, then falls back to default-variant-of-product lookup. This resolves the spec §10 item about the misleading parameter name.

15. **`verify_stock_integrity` coverage.** The function checks four conditions: ledger-vs-on_hand, projection-vs-ledger, unvalued movements, and cache-vs-projection. The projection-vs-ledger check (the one the prompt specifically asks about) correctly compares `running_quantity` of the latest projection row against `SUM(quantity_delta)` from `stock_movements`. All four checks are verified by the unit test.

## Checks run
typecheck: ✅ pass   tests: ✅ 571 passed (44 files, 0 failed, 0 skipped)   audit:invariants (--strict): ✅ pass (8 checks, 0 violations)
