# Audit: m2b/stocktake
Spec: docs/tasks/warehouse-m2b-stocktake.md   Reviewed: b1e5473bd6a4858e87843add2aaa4177df59d5bb   Date: 2026-11-04

## Verdict
BLOCK — Stocktakes created via the UI cannot be posted due to ST010 posting_date validation failure, conflict override arithmetic erases interleaved sales, and opening count variance calculation contradicts posting deltas.

## Findings
### 1. Default Header `posting_date` Causes Guaranteed ST010 Rejection on Any Stocktake Created via UI  [severity: blocker]
- Where: `supabase/migrations/20261104150000_m2b_resolution_staleness.sql:54-62`, `artifacts/store/src/components/admin/NewStocktakeModal.tsx:34-43`, `artifacts/api-server/src/routes/admin/stocktakes.ts:67,215-228`
- Failing scenario:
  1. Owner creates a stocktake via Admin UI modal at 09:00:00 (`POST /admin/stocktakes` with `{ title: "Morning Count" }`). No `posting_date` is supplied by the modal, so `stocktakes.posting_date` defaults to database `now()` (`2026-11-04 09:00:00.000Z`).
  2. Staff member scans barcode at 09:05:00 (`POST /admin/stocktakes/:id/lines`). Trigger `trg_capture_stocktake_line_snapshot` captures snapshot with `captured_at = now()` (`2026-11-04 09:05:00.000Z`).
  3. Owner reviews variance at 09:30:00 and clicks "Post Stocktake" in `StocktakeVariancePage.tsx` (`POST /admin/stocktakes/:id/post`).
  4. Backend invokes `post_stocktake(id, actor_id)`.
  5. Step 3 checks:
     ```sql
     IF EXISTS (
       SELECT 1 FROM public.stocktake_lines stl
       JOIN public.stocktake_line_snapshots stls ON stls.line_id = stl.id
       WHERE stl.stocktake_id = p_stocktake_id
         AND v_st.posting_date < stls.captured_at
     ) THEN
       RAISE EXCEPTION 'Stocktake posting_date (%) cannot be earlier than contributing line observations',
         v_st.posting_date USING ERRCODE = 'ST010';
     END IF;
     ```
     Because `v_st.posting_date` (09:00:00) < `stls.captured_at` (09:05:00), the condition matches.
  6. The RPC raises `ST010: Stocktake posting_date (2026-11-04 09:00:00+00) cannot be earlier than contributing line observations`, aborting the transaction.
  7. The UI displays "Failed to post stocktake". Neither the UI nor the `/post` endpoint updates `posting_date` to the time of posting, so every single stocktake created through the normal workflow is permanently unpostable.
- Invariant or spec clause violated: Spec §4 & §11.4/11.5 ("Admin UI: a phone-first counting screen built around the scanner; an owner variance review... posting corrections"). Will bite immediately on the first real count attempt in production.

### 2. Reconciled Override Measured Against Latest Snapshot Erases Interleaved Sales  [severity: blocker]
- Where: `supabase/migrations/20261104150000_m2b_resolution_staleness.sql:178-185`, `artifacts/api-server/src/lib/stocktake-variance.ts:101-105`
- Failing scenario:
  1. Counter 1 counts Variant V on the front shelf at 10:00. Store on-hand is 10. Counter enters 10 (`id = line_1`, `created_at = 10:00`). Snapshot 1 records `snapshot_on_hand = 10`.
  2. Between 10:00 and 12:00, 2 units are sold to store customers. Store on-hand drops to 8.
  3. At 12:00, Counter 2 erroneously re-scans Variant V and enters 6 (`id = line_2`, `created_at = 12:00`). Snapshot 2 records `snapshot_on_hand = 8`.
  4. Owner reviews conflicting scans and resolves the conflict by overriding with Counter 1's observation: `resolution_type = 'override'`, `chosen_line_id = line_1`, `resolved_quantity = 10`.
  5. Stocktake is posted. `post_stocktake` reconciles Variant V:
     `effective_counted` is set to `sr.resolved_quantity` (10).
     `effective_snapshot` is retrieved via:
     ```sql
     LEFT JOIN LATERAL (
       SELECT stls.snapshot_on_hand
       FROM public.stocktake_lines stl
       JOIN public.stocktake_line_snapshots stls ON stls.line_id = stl.id
       WHERE stl.stocktake_id = p_stocktake_id AND stl.variant_id = vs.variant_id
       ORDER BY stl.created_at DESC
       LIMIT 1
     ) latest_snap ON true
     ```
     Because `ORDER BY stl.created_at DESC LIMIT 1` is hardcoded across all lines of that variant, `latest_snap` selects `line_2`'s snapshot (8), completely ignoring `chosen_line_id` (`line_1`).
  6. Delta posted is `effective_counted (10) - effective_snapshot (8) = +2`.
  7. New store on-hand becomes `8 + 2 = 10`.
  8. The 2 sales between 10:00 and 12:00 are completely erased, resurrecting phantom inventory.
- Invariant or spec clause violated: Spec §4: "A count is an observation at a moment in time, not a command to set a number... Sales that happen afterwards land on top and stay intact." Invariant `.agents/rules/inventory.md` ledger immutability and accurate on-hand tracking. Will bite during the first count whenever staff double-scan a variant and the owner chooses the earlier scan.

### 3. Opening Count Variance & Shrinkage Calculation Uses Counted Quantity Instead of Snapshot Delta  [severity: blocker]
- Where: `artifacts/api-server/src/lib/stocktake-variance.ts:142-144`
- Failing scenario:
  1. Variant V exists with a legacy migrated on-hand balance of 10 units at unit cost 20 AZN.
  2. Owner initiates the opening count (`is_opening_count = true`).
  3. Staff physically counts 4 units (6 units have been stolen or lost). Line is created with `counted_quantity = 4`, `snapshot_on_hand = 10`.
  4. Owner opens the variance review screen. `computeStocktakeVariance` calculates:
     ```typescript
     const varianceQty = stocktake.is_opening_count
       ? countedQuantity
       : Number((countedQuantity - snapshotOnHand).toFixed(3));
     ```
     `varianceQty` evaluates to `4` (positive) instead of `-6` (`4 - 10 = -6`).
  5. Because `varianceQty = 4 > 0`, shrinkage calculation skips this item: `shrinkageValue = 0 AZN` (ignoring the 120 AZN loss), and `variance_value` reports `+80 AZN`.
     If physical count were 0 (all 10 units lost), `varianceQty` evaluates to `0`, reporting 0 discrepancy and 0 shrinkage.
  6. Owner reviews report showing positive variance and 0 shrinkage, then clicks Post.
  7. `post_stocktake` executes: `delta = effective_counted (4) - effective_snapshot (10) = -6`, posting a movement of `-6` and reducing stock by 6 units.
  8. The variance and shrinkage numbers presented to the owner directly contradict the posted ledger movements.
- Invariant or spec clause violated: Spec §6 & §8: "The first count is not a correction of a previous belief... the total value of negative corrections for the period: shrinkage, in manat". Will bite on day one during the opening count review.

### 4. Resolution Staleness Check Blind to Typo Fixes / Line Quantity Updates  [severity: major]
- Where: `supabase/migrations/20261104150000_m2b_resolution_staleness.sql:92-108`, `artifacts/api-server/src/lib/stocktake-variance.ts:119-122`
- Failing scenario:
  1. Two staff scan Variant V at 10:00 and 10:05, each recording `counted_quantity = 5`.
  2. Owner resolves conflict at 10:10 with `resolution_type = 'sum'`, `resolved_quantity = 10`.
     `stocktake_resolutions` records `resolved_line_count = 2`, `resolved_latest_line_at = 10:05`.
  3. At 10:15, Counter 1 realizes they mistyped and edits Line 1 via the Typo Fix modal (`PATCH /admin/stocktakes/:id/lines/:lineId`) from 5 to 50.
  4. The PATCH route updates `counted_quantity = 50` and `updated_at = 10:15`, but leaves `created_at = 10:00` untouched.
  5. The number of lines is still 2, and `MAX(created_at)` remains `10:05`.
  6. Owner posts stocktake. Step 4b checks:
     `COALESCE(cur.current_line_count, 0) <> sr.resolved_line_count` (2 vs 2: False).
     `cur.current_latest_line_at > sr.resolved_latest_line_at` (10:05 vs 10:05: False).
  7. The staleness check reports the resolution is valid and does not raise ST011.
  8. `post_stocktake` posts the stale `resolved_quantity = 10` instead of the corrected count (55).
  9. The typo fix of 45 units is silently discarded without warning.
- Invariant or spec clause violated: Spec §7 & §10 Q4: "Concurrent counting by three staff: ownership, duplicate lines, conflict surfacing... do not silently keep the last write." Will bite whenever a counter amends a count line after a resolution has been logged.

### 5. Express Routes Bypass RLS Using Service Role, Permitting Line Deletions on Posted Stocktakes and Draft Deletions by Staff  [severity: major]
- Where: `artifacts/api-server/src/routes/admin/stocktakes.ts:117-143`, `artifacts/api-server/src/routes/admin/stocktake-lines.ts:76-128`
- Failing scenario:
  1. Stocktake `ST-001` has been posted by the owner and movements are committed.
  2. Any staff token sends `DELETE /admin/stocktakes/:id/lines/:lineId` targeting one of its contributing lines.
  3. The route middleware verifies `role === 'staff'` and attaches `admin = getAdminSupabase()`.
  4. The route does NOT check `stocktakes.status === 'draft'` and executes `admin.from('stocktake_lines').delete().eq('id', lineId)`.
  5. Because the service role client bypasses RLS, the deletion succeeds. Foreign key `ON DELETE CASCADE` deletes the corresponding row from `stocktake_line_snapshots`.
  6. The immutable audit trail of the posted stocktake is permanently damaged. Subsequent variance reviews throw missing snapshot exceptions.
  7. Similarly, any staff token can call `DELETE /admin/stocktakes/:id` on a draft stocktake created by another user, despite RLS granting draft deletion only to admin.
- Invariant or spec clause violated: Spec §7: "A posted stocktake is immutable, like a receipt. A mistake is corrected by another count, not by editing history." Invariant `.agents/rules/inventory.md`: role boundaries and immutable movement auditability. Security boundary vulnerability that allows non-admin tokens to modify posted stocktakes or delete drafts.

### 6. Negative Opening Balance in `recompute_variant_cost` Injects Negative Basis and Triggers Division by Zero  [severity: major]
- Where: `supabase/migrations/20261104110000_m2a_functions_triggers.sql:432-434`, `supabase/migrations/20261104150000_m2b_resolution_staleness.sql:208-223`
- Failing scenario:
  1. Variant V was migrated with an unvalued placeholder balance of 10 units (`v_basis_qty = 0`).
  2. Opening count finds 4 units physically present. Posting creates movement with `reason = 'opening_balance'`, `quantity_delta = -6`.
  3. Owner entered opening cost of 20 AZN.
  4. `post_stocktake` invokes `recompute_variant_cost(p_variant_id, v_st.posting_date)`.
  5. In `recompute_variant_cost`, Case B (`ELSIF v_m.reason = 'opening_balance'`) executes:
     Because `v_basis_qty <= 0` (it is 0), line 434 executes:
     `v_basis_qty := v_m.quantity_delta;` -> `v_basis_qty := -6`!
  6. Later, a goods receipt of 6 units arrives at 30 AZN.
  7. When `recompute_variant_cost` runs on the receipt:
     `v_avg_cost := ((v_basis_qty * v_avg_cost) + (v_m.quantity_delta * v_unit_cost)) / (v_basis_qty + v_m.quantity_delta);`
     The denominator is `(-6) + 6 = 0`.
  8. Postgres aborts the transaction with Division-by-Zero runtime error, permanently blocking receipt posting for that variant.
- Invariant or spec clause violated: Spec §6: "The first count is not a correction of a previous belief... what keeps an unvalued opening quantity out of the weighted average". Will bite whenever opening count adjusts legacy stock downwards and is followed by stock receiving.

## Checked and found sound
- **Atomic posting transaction and lock guards**: `post_stocktake` uses `SELECT ... FOR UPDATE` row locks, preventing duplicate concurrent posting attempts and rolling back cleanly on simulated line errors without leaving orphaned movement rows.
- **Blind counting storage and schema isolation**: `stocktake_line_snapshots`, `stocktake_opening_costs`, and `stocktake_resolutions` have dedicated RLS policies restricting access to `is_admin()`. PostgREST queries with staff tokens return empty sets.
- **Single posted opening count constraint**: `idx_single_posted_opening_stocktake` partial unique index on `(is_opening_count) WHERE (is_opening_count = true AND status = 'posted')` successfully blocks duplicate posted opening counts.
- **Zero-movement filtering**: Posting explicitly filters `WHERE vd.delta <> 0`, correctly omitting no-op movements and respecting the movement ledger constraint against zero deltas.
- **No inventory reservations or promises treated as stock changes**: Neither schema additions nor stocktake queries introduce reservation locks or availability deductions.
- **Property test run counts**: `storefront-ux.property.test.ts` Property 3 run count was restored to 200 without flaking.
- **Orval / OpenAPI codegen synchronization**: Hand edits to generated files are absent; generated files match `openapi.yaml`.

## Checks run
typecheck: exit 0 (passed across all 5 workspace projects)
tests: exit 0 (608 passed across 49 test files)
audit:invariants: exit 0 (10 checks passed, 0 violations, 0 new)
