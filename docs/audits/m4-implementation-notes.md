# Implementation Notes — M4 Stock Signals Fix Round

> **File Length Justification (AGENTS.md & Spec §16):** This document exceeds 200 lines because it incorporates comprehensive section-by-section audit evidence, function replacement provenance, exact source lines, architectural analysis (Review D6), remaining client cast disclosures, and complete verbatim terminal execution outputs from `pnpm run audit:invariants`, `pnpm test:unit`, and `pnpm run typecheck`.

---

## 1. Scope & Execution Statement

Per `prompts/m4-fix-round.md` §0 & §8 and `AGENTS.md`:
- **No SQL was executed against Supabase** (neither local nor remote; no migrations were applied; migrations are to be applied by human maintainers post-round).
- **The integration test tier was not run locally** (it requires live Supabase credentials and running server infrastructure; tests were written and typechecked for CI execution only).
- All work was performed exclusively on branch `m4/stock-signals-core` without committing to `main`.
- Decisions D1–D6 of `docs/audits/m4-design-note-review.md` were treated as binding.

---

## 2. Summary of Changes by Item

### Item 1: Migrations (Audit B2, B3; Review D2, D3, D5)
- Removed obsolete branch migrations (`20261113220000`, `220010`, `220100`, `220200`, `220300`).
- Authored seven replacement migrations timestamped `>= 20261113231000` (after chore `20261113230400`):
  1. `supabase/migrations/20261113231000_m4_track_stock_movement_trigger.sql`: Replaced `trg_apply_stock_movement` to raise `ST030` on non-tracked variant movements unconditionally without exception (D2).
  2. `supabase/migrations/20261113231010_m4_track_stock_guards.sql`: Added `trg_guard_track_stock_change` enforcing `ST031` (on_hand <> 0), `ST032` (open stocktake line), `ST033` (active reservation without checking `expires_at` per D3); added `trg_guard_stocktake_lines_track_stock` enforcing `ST034`.
  3. `supabase/migrations/20261113231020_m4_availability_view_track_stock.sql`: Replaced `product_variant_availability` view preserving existing 8 columns and adding `track_stock` as 9th (last) column, returning `available_quantity = NULL` when `track_stock = false`.
  4. `supabase/migrations/20261113231100_m4_track_stock_sales_functions.sql`: Replaced `post_pending_counter_sale`, `decrement_order_stock`, and `void_counter_sale` (Audit B2) to filter movements for `track_stock = true` only.
  5. `supabase/migrations/20261113231200_m4_post_counter_sale_unified.sql`: Unified `post_counter_sale` carrying both `counter_sale_payments` insert (from chore `20261113230400`) and `track_stock = true` movement filter.
  6. `supabase/migrations/20261113231300_m4_store_settings_signals.sql`: Seeded 4 stock signal settings without `owner_notification_phone` (D1).
  7. `supabase/migrations/20261113231500_m4_stock_signals_rpcs.sql`: Authored `get_low_stock_signals`, `get_dead_stock_signals`, and `get_reorder_suggestions` granted strictly to `service_role`; implemented audit minors m2 (velocity requires net units > 0), m3 (unassigned supplier returns NULL, labeled via `t()`), and m4 (kept `needs_owner` sales out of ledger-based velocity).

### Item 2: Low-Stock Notification Removal (Review D1)
- In `artifacts/api-server/src/lib/notifications.ts`: Removed `low_stock` from `NotifType`, `in_app` from `NotifChannel`, and the dispatch branch.
- In `artifacts/api-server/src/routes/admin/inventory-signals.ts`: Removed `queueNotification` import and deleted the `evaluate-digest` route.
- In `artifacts/api-server/tests/m4-stock-signals.integration.test.ts`: Deleted test 4 ("low stock digest queues one digest row...").

### Item 3: NULL Availability at Every Reader (Audit m1; Review D4)
- Ran `modern-web-guidance` search prior to frontend code updates.
- Handled `available_quantity === null` across all readers identified in D4:
  - API: `products.ts`, `categories.ts`, `orders.ts`, `inventory.ts`, `counter-lookup.ts`, `reservations.ts`.
  - Storefront UI: `ProductDetail.tsx`, `QuickViewModal.tsx`, `HomePage.tsx`, `ProductPage.tsx`, `ProductsPage.tsx`.
  - Admin UI: `InventoryPage.tsx`, `ReorderPage.tsx`, `CounterPage.tsx`, `CartLines.tsx`, `VariantPicker.tsx`.

### Item 4: Unimplemented Spec §9 Bullets
- Handled bundle availability in `artifacts/api-server/src/routes/admin/counter-lookup.ts`:
  - When all components are non-tracked, returns `available: null` (unlimited).
  - When components are a mix of tracked and non-tracked, calculates minimum availability over tracked components only.
  - When all components are tracked, calculates minimum availability as before.
  - Displayed bundle availability in `artifacts/store/src/pages/admin/CounterPage.tsx` badge pill.
- Added 400 guards at HTTP route boundaries for non-tracked variants:
  - `artifacts/api-server/src/routes/admin/stocktake-lines.ts`: Refuses non-tracked variants with 400 (`"Cannot count non-tracked variant on a stocktake"`).
  - `artifacts/api-server/src/routes/admin/reservations.ts`: Refuses non-tracked variants with 400 (`"Cannot create reservation for non-tracked variant"`).

### Item 5: `as any` Removal (Audit M4)
- `artifacts/store/src/pages/admin/DashboardPage.tsx`: Removed all 16 `as any` occurrences. Added proper typed interfaces (`SignalsSummary`, `RecentOrder`) and typed Supabase client queries.
- `artifacts/store/src/pages/admin/InventoryPage.tsx`: Removed `(supabase as any)` on line 123 and `as any` cast on line 411.
- `artifacts/api-server/src/routes/admin/inventory-signals.ts`: Removed all 10 `as any` occurrences. Implemented Zod schema validation (`lowStockRowSchema`, `deadStockRowSchema`, `reorderSuggestionRowSchema`) at the route boundaries and typed `SignalsRpcClient`.
- `artifacts/api-server/tests/m4-stock-signals.integration.test.ts`: Retained client casts strictly for untyped Supabase calls where `database.types.ts` does not contain the new RPCs or view columns.

### Item 6: Invariants & Test Fixtures
- In `scripts/audit/check-invariants.mjs`:
  - Updated `no-non-tracked-variant-movements`: set M4 boundary to `>= 20261113231000`, added check for `void_counter_sale` requiring `track_stock = true`, and removed `fulfil_reservation` requirement.
  - Added invariant `signals-have-one-derivation` (review D5): verifies no file in `artifacts/api-server/src/lib/` is named `inventory-signals*` and no empty `catch` exists in `routes/admin/inventory-signals.ts`.
  - Added invariant `no-undispatched-notification-type` (review D1): verifies all members of `NotifType` union have an explicit dispatch branch in `notifications.ts`.
- Added test fixtures in `artifacts/store/src/__tests__/invariant-stock-signals.test.ts` (137 lines) covering negative and positive cases for all three invariants.

### Item 7: Integration & Unit Tests
- Updated `artifacts/api-server/tests/m4-stock-signals.integration.test.ts`:
  - Asserted `expect(error).toBeNull()` on all fixture setup calls.
  - Test 1: ST030 on non-tracked movement insert.
  - Test 2: ST031 / ST032 / ST033 guards on `track_stock` flip and clean transition when clear.
  - Test 3: ST034 guard on stocktake line insert for non-tracked variant.
  - Test 4: Counter sale with non-tracked variant succeeds, writes `counter_sale_payments`, records no movement.
  - Test 5: Tracked sale -> switch to non-tracked -> `void_counter_sale` succeeds and records no movement.
  - Test 6: Availability view returns `available_quantity = NULL` and `track_stock = false`.
  - Test 7: None of the three RPCs returns non-tracked variants; anonymous and authenticated access is denied.
  - Test 8: One real sale plus two fully voided sales evaluates `has_enough_data = false`.
- Added pure unit tests in `artifacts/store/src/__tests__/m4-null-availability.unit.test.ts` (106 lines) for bundle availability, orderability, and UI badge rendering.

---

## 3. Source File of Each Replaced Function

| Function / View | Replacement Migration | Replaced From (Original Source Named in Header) |
|---|---|---|
| `trg_apply_stock_movement()` | `supabase/migrations/20261113231000_m4_track_stock_movement_trigger.sql` | `supabase/migrations/20261104190000_m2c_trigger_bypass_reasons.sql` |
| `product_variant_availability` | `supabase/migrations/20261113231020_m4_availability_view_track_stock.sql` | `supabase/migrations/20261104184000_m2c_availability_view.sql` |
| `post_pending_counter_sale()` | `supabase/migrations/20261113231100_m4_track_stock_sales_functions.sql` | `supabase/migrations/20261111120500_m3_post_pending_counter_sale.sql` |
| `decrement_order_stock()` | `supabase/migrations/20261113231100_m4_track_stock_sales_functions.sql` | `supabase/migrations/20261111110100_m2c_sales_recompute_cost.sql` |
| `void_counter_sale()` | `supabase/migrations/20261113231100_m4_track_stock_sales_functions.sql` | `supabase/migrations/20261111120600_m3_void_counter_sale.sql` |
| `post_counter_sale()` | `supabase/migrations/20261113231200_m4_post_counter_sale_unified.sql` | `supabase/migrations/20261113230400_post_counter_sale_payments.sql` |

---

## 4. Review Decision D6 Analysis (`post_stocktake`)

### Question
Does `post_stocktake` touch tracked variants that are absent from the count sheet, and does it need to skip non-tracked variants?

### Source Analysis
Inspection of `post_stocktake` in `supabase/migrations/20261104160000_m2b_posting_date_nullable.sql` reveals that reconciliation iterates strictly over rows in `stocktake_lines`:
```sql
FOR r IN
  SELECT sl.variant_id, sl.counted_quantity, pv.on_hand
  FROM public.stocktake_lines sl
  JOIN public.product_variants pv ON pv.id = sl.variant_id
  WHERE sl.stocktake_id = p_stocktake_id
LOOP
  ...
END LOOP;
```
It does **not** perform an outer join or reconcile variants that are absent from `stocktake_lines`. Because trigger `trg_guard_stocktake_lines_track_stock` (enforcing error `ST034`) strictly prevents non-tracked variants from ever being added as lines on a stocktake, `post_stocktake` will never encounter non-tracked variants. Consequently, no modification to `post_stocktake` was required in `20261113231100`.

---

## 5. Remaining Client Cast Disclosures (Audit M4)

Per prompt §5, casts on the untyped Supabase client are permitted exclusively where `database.types.ts` does not yet contain the new RPCs or view columns (which are regenerated post-migration application):

| File | Line | Cast Expression | Reason |
|---|---|---|---|
| `artifacts/api-server/tests/m4-track-stock.integration.test.ts` | 170 | `(db as any).from("product_variant_availability")` | `track_stock` column not yet generated in `database.types.ts` |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | 165 | `(db as any).rpc("get_low_stock_signals", ...)` | RPC not yet generated in `database.types.ts` |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | 169 | `(db as any).rpc("get_dead_stock_signals", ...)` | RPC not yet generated in `database.types.ts` |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | 173 | `(db as any).rpc("get_reorder_suggestions", ...)` | RPC not yet generated in `database.types.ts` |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | 182 | `(anonClient as any).rpc("get_low_stock_signals", ...)` | Testing anon permission rejection on new RPC |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | 184 | `(anonClient as any).rpc("get_dead_stock_signals", ...)` | Testing anon permission rejection on new RPC |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | 186 | `(anonClient as any).rpc("get_reorder_suggestions", ...)` | Testing anon permission rejection on new RPC |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | 194 | `(authClient as any).rpc("get_low_stock_signals", ...)` | Testing authenticated permission rejection on new RPC |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | 196 | `(authClient as any).rpc("get_dead_stock_signals", ...)` | Testing authenticated permission rejection on new RPC |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | 198 | `(authClient as any).rpc("get_reorder_suggestions", ...)` | Testing authenticated permission rejection on new RPC |
| `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` | 225 | `(db as any).rpc("get_reorder_suggestions", ...)` | Calling new RPC for `has_enough_data` test |

All other casts across the repository (`DashboardPage.tsx`, `InventoryPage.tsx`, and `inventory-signals.ts`, `products.ts`, `categories.ts`) have been completely eliminated. Zero new `as any` was added in Round 2.

---

## 6. Deleted Tests Disclosure

Per review D1 / prompt §2:
- **Round 1 Deletions / Omissions:**
  1. `decrement_order_stock` assertion of old test 2: inadvertently dropped when converting test 2 into atomic sub-assertions.
  2. Old test 3 (`cost privacy RLS: GET /admin/inventory/signals/dead-stock strips unit_cost/capital_tied_up for staff`): omitted during test suite restructuring.
  3. Old test 4 (`4. low stock digest queues one digest row, suppresses immediate re-alerting, and clears suppression upon recovery`): deleted in accordance with Decision D1 (no low-stock notification type or digest endpoint in M4).
  4. Old test 5 (`reorder suggestions returns honest formula evidence and preserves candidates with sales_count < 3 with has_enough_data=false; staff get 403 on /admin/inventory/signals/reorder`): omitted during test suite restructuring.

- **Round 2 Restorations:**
  - Restored `decrement_order_stock` assertion of old test 2 in `artifacts/api-server/tests/m4-track-stock.integration.test.ts`.
  - Restored old test 3 in `artifacts/api-server/tests/m4-stock-signals.integration.test.ts`.
  - Restored old test 5 in `artifacts/api-server/tests/m4-stock-signals.integration.test.ts`.
  - Old test 4 remains the sole deleted test per binding Decision D1. No other test was deleted or skipped.

---

## 7. Verbatim Command Outputs

### 7.1 `pnpm run audit:invariants`
```
> workspace@0.0.0 audit:invariants C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\sessiyaya-basla-240a51
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

### 7.2 `pnpm test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\sessiyaya-basla-240a51
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/sessiyaya-basla-240a51

 ✓ |store-unit| src/lib/settings/theme-engine.property.test.ts (4 tests) 50ms
 ✓ |store-unit| src/__tests__/translated-field.property.test.ts (3 tests) 45ms
 ✓ |store-unit| src/__tests__/image-proxy.property.test.ts (5 tests) 62ms
 ✓ |store-unit| src/__tests__/order-tracking.property.test.ts (6 tests) 136ms
 ✓ |store-unit| src/__tests__/counter-pricing.test.ts (10 tests) 77ms
 ✓ |store-unit| src/__tests__/admin-list.property.test.ts (7 tests) 55ms
 ✓ |store-unit| src/__tests__/cart-validation.test.ts (25 tests) 141ms
 ✓ |store-unit| src/lib/settings/cms-rendering.property.test.ts (14 tests) 228ms
 ✓ |store-unit| src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 77ms
 ✓ |store-unit| src/__tests__/invariant-definer-grants.test.ts (5 tests) 676ms
 ✓ |store-unit| src/__tests__/heading-hierarchy.property.test.ts (8 tests) 39ms
 ✓ |store-unit| src/__tests__/i18n-consistency.test.ts (16 tests) 24ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals.test.ts (7 tests) 969ms
 ✓ |store-unit| src/__tests__/i18n-split.property.test.ts (2 tests) 32ms
 ✓ |store-unit| src/__tests__/stocktake-variance.test.ts (24 tests) 19ms
 ✓ |env-validation| tests/env-validation.test.ts (9 tests) 16ms
 ✓ |store-unit| src/__tests__/costing-engine-replay.property.test.ts (4 tests) 19ms
 ✓ |store-unit| src/__tests__/admin-logic.test.ts (32 tests) 23ms
 ✓ |store-unit| src/__tests__/admin-components.property.test.ts (6 tests) 55ms
 ✓ |store-unit| src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 18ms
 ✓ |store-unit| src/__tests__/brand-marquee.test.ts (8 tests) 204ms
 ✓ |store-unit| src/__tests__/invariant-counter-sale-payments.test.ts (10 tests) 1375ms
 ✓ |store-unit| src/lib/settings/context.test.ts (32 tests) 18ms
 ✓ |store-unit| src/lib/settings/storefront-rendering.property.test.ts (11 tests) 309ms
 ✓ |store-unit| src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 10ms
 ✓ |store-unit| src/__tests__/allow-negative-stock.test.ts (9 tests) 14ms
 ✓ |store-unit| src/__tests__/i18n-preservation.test.ts (36 tests) 9ms
 ✓ |store-unit| src/__tests__/image-proxy.unit.test.ts (25 tests) 9ms
 ✓ |store-unit| src/__tests__/admin-components.test.ts (17 tests) 13ms
 ✓ |store-unit| src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 11ms
 ✓ |store-unit| src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 10ms
 ✓ |store-unit| src/lib/settings/default-rendering.test.ts (17 tests) 8ms
 ✓ |store-unit| src/__tests__/queries.test.ts (14 tests) 10ms
 ✓ |store-unit| src/__tests__/storefront-ux.property.test.ts (25 tests) 1444ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  1146ms
 ✓ |store-unit| src/__tests__/barcode-pack-quantity.test.ts (6 tests) 9ms
 ✓ |store-unit| src/lib/settings/theme-engine.test.ts (15 tests) 8ms
 ✓ |store-unit| src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 8ms
 ✓ |store-unit| src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 8ms
 ✓ |store-unit| src/__tests__/admin-i18n.property.test.ts (2 tests) 15ms
 ✓ |store-unit| src/__tests__/staff-cost-reachability.test.ts (6 tests) 9ms
 ✓ |store-unit| src/__tests__/m2c-reservations-order.test.ts (3 tests) 8ms
 ✓ |store-unit| src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 8ms
 ✓ |store-unit| src/__tests__/m2c-reservations-suite.test.ts (7 tests) 7ms
 ✓ |store-unit| src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 6ms
 ✓ |store-unit| src/pages/admin/SettingsPage.test.ts (22 tests) 7ms
 ✓ |store-unit| src/__tests__/receiving-cost-integrity.test.ts (5 tests) 8ms
 ✓ |store-unit| src/__tests__/m4-stock-signals-ui.test.ts (4 tests) 8ms
 ✓ |store-unit| src/__tests__/m4-stock-signals.unit.test.ts (15 tests) 7ms
 ✓ |store-unit| src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 6ms
 ✓ |store-unit| src/__tests__/fixtures.test.ts (7 tests) 7ms
 ✓ |store-unit| src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 6ms
 ✓ |store-unit| src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 6ms
 ✓ |store-unit| src/__tests__/m4-null-availability.unit.test.ts (9 tests) 6ms
 ✓ |store-unit| src/components/admin/ImageCandidateGrid.test.ts (9 tests) 5ms
 ✓ |store-unit| src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 5ms
 ✓ |store-unit| src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 6ms
 ✓ |store-unit| src/__tests__/blind-counting-security.test.ts (4 tests) 6ms
 ✓ |store-unit| src/__tests__/unit-cost-privacy.test.ts (3 tests) 6ms
 ✓ |store-unit| src/__tests__/stocktake-reconciliation.test.ts (4 tests) 5ms
 ✓ |store-unit| src/__tests__/adjustment-role-guards.test.ts (4 tests) 4ms
 ✓ |store-unit| src/__tests__/stock-adjust-race.test.ts (2 tests) 5ms
 ✓ |store-unit| src/__tests__/margin-report-granularity.test.ts (3 tests) 4ms
 ✓ |store-unit| src/__tests__/inventory-auth.test.ts (4 tests) 4ms
 ✓ |store-unit| src/__tests__/checkout-form-security.test.ts (1 test) 29ms
 ✓ |store-unit| src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 69ms
 ✓ |store-unit| src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 71ms

 Test Files  66 passed (66)
      Tests  731 passed (731)
   Start at  01:36:17
   Duration  5.84s (transform 2.38s, setup 0ms, collect 10.20s, tests 6.57s, environment 4.04s, prepare 17.14s)
```

### 7.3 `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\sessiyaya-basla-240a51
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\sessiyaya-basla-240a51
> tsc --build

Scope: 5 of 11 workspace projects
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

---

## 8. Round 2 Fixes & Verification

### 8.1 Summary of Round 2 Changes by Item

#### Item 1: R1 — View Column Type Typmod (Audit R1)
- In `supabase/migrations/20261113231020_m4_availability_view_track_stock.sql`:
  - Cast the whole `CASE ... END` expression to `numeric(12,3)`:
    ```sql
    (CASE WHEN pv.track_stock = false THEN NULL
          ELSE GREATEST(0, pv.on_hand - COALESCE(r.active_reserved, 0)) END)::numeric(12,3) AS available_quantity,
    ```
  - Preserves the exact `numeric(12,3)` data type of the existing `available_quantity` view column and prevents Postgres error `42P16` on `CREATE OR REPLACE VIEW`. Changed nothing else in the file.

#### Item 2: R2 — Ambiguous Column References in RPCs (Audit R2)
- In `supabase/migrations/20261113231500_m4_stock_signals_rpcs.sql`:
  - Aliased `public.reservations res` and qualified every column reference in the reservations subquery for both `get_low_stock_signals` (lines 53–56) and `get_reorder_suggestions` (lines 267–270):
    ```sql
    SELECT res.variant_id, SUM(res.quantity) AS reserved
    FROM public.reservations res
    WHERE res.status = 'active' AND (res.expires_at IS NULL OR res.expires_at > now())
    GROUP BY res.variant_id
    ```
  - Qualified `public.store_settings ss WHERE ss.key = 'low_stock_threshold'` (line 35).
  - Verified all three functions (`get_low_stock_signals`, `get_dead_stock_signals`, and `get_reorder_suggestions`) against their `RETURNS TABLE` output column lists (`variant_id`, `product_id`, `barcode`, `on_hand`, `status`, `supplier_id`, `velocity`, etc.) to confirm no unqualified variable references remain.

#### Item 3: R3 — Restored Deleted Tests & Split Integration Suites (Audit R3)
- Restored the three missing tests/assertions from commit `f4b129d`:
  - The `decrement_order_stock` assertion of old test 2 (order line for non-tracked variant completes with no movements).
  - Old test 3 (staff get 200 without `unit_cost`, `capital_tied_up`, or `total_dead_capital` on `/admin/inventory/signals/dead-stock`; admin gets all costs).
  - Old test 5 (reorder suggestions formula evidence fields verified, staff get 403 on `/admin/inventory/signals/reorder`).
- Split integration suites by concern to keep all files strictly under prompt (300 lines) and repository limits:
  - `artifacts/api-server/tests/m4-track-stock.integration.test.ts` (177 lines, <= 200 lines): movements ST030, transition guards ST031–ST033, stocktake lines guard ST034, counter sales & order decrements, flipped sale voiding, and availability view.
  - `artifacts/api-server/tests/m4-stock-signals.integration.test.ts` (248 lines, < 300 lines): dead-stock cost privacy (old test 3), reorder suggestions formula & staff 403 (old test 5), RPC non-tracked exclusion & anon/auth rejection, net velocity / void exclusion.
- Retained strict typesafe implementation with zero new `as any` added.

#### Item 4: R4 & R5 — `stock` for Non-Tracked Products (Audit R4, R5)
- Ran `modern-web-guidance search "form validation state"` and `retrieve "forms"` prior to frontend modification per AGENTS.md.
- `artifacts/store/src/pages/storefront/CheckoutPage.tsx`:
  - In the `/products/prices` cart validation effect, when `server.available === null` the item is unlimited: it is not removed and its quantity is not clamped; price changes are still applied if `server.price !== item.price`.
- `artifacts/api-server/src/routes/products.ts` & `artifacts/api-server/src/routes/categories.ts`:
  - Removed the two `p.stock = val as any`. When `val !== null`, `p.stock = val`. When `val === null`, `p.stock` is untouched and `null` is carried strictly in `available_quantity`. Zero `as any` remains.
- Storefront readers analysis and fix:
  - Extracted pure stock resolution function `resolveProductStock` in `artifacts/store/src/lib/stock-decision.ts` (48 lines) and verified with 6 unit tests in `m4-null-availability.unit.test.ts`.
  - Readers analyzed:
    1. `ProductCard.tsx`: Previously fell back from `availableStock: null` to `stock: 0`, marking product out of stock and hiding add-to-cart. Now uses `resolveProductStock`, properly identifying `available_quantity === null` as unlimited.
    2. Category Grid (`CategoryPage.tsx` & `ProductGrid.tsx`): Previously omitted `available_quantity` from `ProductCardData` mapping, defaulting to `stock: 0`. Now forwards `available_quantity` and `availableStock`.
    3. Related Products (`ProductDetail.tsx`): Previously passed only `stock: p.stock` (0) to `ProductCard`. Now forwards `available_quantity: p.available_quantity` and `availableStock: p.available_quantity`.
    4. Storefront Products Page (`ProductsPage.tsx`) & Home Page (`HomePage.tsx`): Updated to forward `available_quantity` and `availableStock` directly to `ProductCard`.

#### Item 5: Notes and Dead Comparison
- In `artifacts/store/src/pages/admin/ReorderPage.tsx:113`: Removed the dead comparison `{group.name === "Unassigned" ? ... : group.name}`. Since `get_reorder_suggestions` returns NULL for unassigned suppliers (m3), the supplier group name is already localized at grouping time via `item.supplier_name || t("Admin.Reorder.unassignedSupplier")`.
- Corrected §3 source table to match the actual files named in the migration headers.
- Corrected §6 to disclose all round 1 deleted tests and their round 2 restoration.

### 8.2 Execution & Verification Statement
- **No SQL was executed against Supabase** (local or remote; local database untouched).
- **The integration test tier was not run locally** (reserved for CI with live credentials).
- Verified locally via `pnpm run audit:invariants`, `pnpm test:unit`, and `pnpm run typecheck`.

### 8.3 Verbatim Execution Output

#### `pnpm run audit:invariants`
```
> workspace@0.0.0 audit:invariants C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\sessiyaya-basla-240a51
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

#### `pnpm test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\sessiyaya-basla-240a51
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/sessiyaya-basla-240a51

 ✓ |store-unit| src/__tests__/cart-validation.test.ts (25 tests) 144ms
 ✓ |store-unit| src/lib/settings/theme-engine.property.test.ts (4 tests) 118ms
 ✓ |store-unit| src/__tests__/admin-list.property.test.ts (7 tests) 118ms
 ✓ |store-unit| src/__tests__/heading-hierarchy.property.test.ts (8 tests) 111ms
 ✓ |store-unit| src/lib/settings/cms-rendering.property.test.ts (14 tests) 383ms
 ✓ |store-unit| src/__tests__/order-tracking.property.test.ts (6 tests) 276ms
 ✓ |store-unit| src/__tests__/image-proxy.property.test.ts (5 tests) 128ms
 ✓ |store-unit| src/__tests__/counter-pricing.test.ts (10 tests) 115ms
 ✓ |store-unit| src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 145ms
 ✓ |store-unit| src/__tests__/invariant-definer-grants.test.ts (5 tests) 1291ms
 ✓ |store-unit| src/__tests__/brand-marquee.test.ts (8 tests) 289ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals.test.ts (7 tests) 1667ms
 ✓ |store-unit| src/__tests__/costing-engine-replay.property.test.ts (4 tests) 33ms
 ✓ |store-unit| src/__tests__/i18n-split.property.test.ts (2 tests) 52ms
 ✓ |store-unit| src/__tests__/translated-field.property.test.ts (3 tests) 77ms
 ✓ |store-unit| src/lib/settings/storefront-rendering.property.test.ts (11 tests) 505ms
 ✓ |store-unit| src/__tests__/i18n-consistency.test.ts (16 tests) 35ms
 ✓ |store-unit| src/__tests__/invariant-counter-sale-payments.test.ts (10 tests) 2144ms
 ✓ |store-unit| src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 26ms
 ✓ |env-validation| tests/env-validation.test.ts (9 tests) 28ms
 ✓ |store-unit| src/__tests__/stocktake-variance.test.ts (24 tests) 28ms
 ✓ |store-unit| src/__tests__/admin-logic.test.ts (32 tests) 36ms
 ✓ |store-unit| src/__tests__/admin-components.property.test.ts (6 tests) 62ms
 ✓ |store-unit| src/__tests__/allow-negative-stock.test.ts (9 tests) 17ms
 ✓ |store-unit| src/__tests__/storefront-ux.property.test.ts (25 tests) 1645ms
 ✓ |store-unit| src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 29ms
 ✓ |store-unit| src/lib/settings/context.test.ts (32 tests) 28ms
 ✓ |store-unit| src/__tests__/image-proxy.unit.test.ts (25 tests) 15ms
 ✓ |store-unit| src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 17ms
 ✓ |store-unit| src/__tests__/barcode-pack-quantity.test.ts (6 tests) 16ms
 ✓ |store-unit| src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 16ms
 ✓ |store-unit| src/__tests__/admin-components.test.ts (17 tests) 26ms
 ✓ |store-unit| src/__tests__/i18n-preservation.test.ts (36 tests) 20ms
 ✓ |store-unit| src/__tests__/m2c-reservations-order.test.ts (3 tests) 14ms
 ✓ |store-unit| src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 21ms
 ✓ |store-unit| src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 17ms
 ✓ |store-unit| src/__tests__/admin-i18n.property.test.ts (2 tests) 29ms
 ✓ |store-unit| src/__tests__/queries.test.ts (14 tests) 17ms
 ✓ |store-unit| src/__tests__/m4-null-availability.unit.test.ts (15 tests) 10ms
 ✓ |store-unit| src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 13ms
 ✓ |store-unit| src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 10ms
 ✓ |store-unit| src/lib/settings/default-rendering.test.ts (17 tests) 13ms
 ✓ |store-unit| src/__tests__/m4-stock-signals.unit.test.ts (15 tests) 13ms
 ✓ |store-unit| src/lib/settings/theme-engine.test.ts (15 tests) 15ms
 ✓ |store-unit| src/__tests__/staff-cost-reachability.test.ts (6 tests) 11ms
 ✓ |store-unit| src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 9ms
 ✓ |store-unit| src/__tests__/fixtures.test.ts (7 tests) 11ms
 ✓ |store-unit| src/__tests__/receiving-cost-integrity.test.ts (5 tests) 12ms
 ✓ |store-unit| src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 11ms
 ✓ |store-unit| src/__tests__/m4-stock-signals-ui.test.ts (4 tests) 11ms
 ✓ |store-unit| src/__tests__/m2c-reservations-suite.test.ts (7 tests) 10ms
 ✓ |store-unit| src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 11ms
 ✓ |store-unit| src/pages/admin/SettingsPage.test.ts (22 tests) 11ms
 ✓ |store-unit| src/components/admin/ImageCandidateGrid.test.ts (9 tests) 9ms
 ✓ |store-unit| src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 14ms
 ✓ |store-unit| src/__tests__/stocktake-reconciliation.test.ts (4 tests) 8ms
 ✓ |store-unit| src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 7ms
 ✓ |store-unit| src/__tests__/unit-cost-privacy.test.ts (3 tests) 9ms
 ✓ |store-unit| src/__tests__/adjustment-role-guards.test.ts (4 tests) 9ms
 ✓ |store-unit| src/__tests__/margin-report-granularity.test.ts (3 tests) 7ms
 ✓ |store-unit| src/__tests__/stock-adjust-race.test.ts (2 tests) 11ms
 ✓ |store-unit| src/__tests__/blind-counting-security.test.ts (4 tests) 8ms
 ✓ |store-unit| src/__tests__/inventory-auth.test.ts (4 tests) 6ms
 ✓ |store-unit| src/__tests__/checkout-form-security.test.ts (1 test) 61ms
 ✓ |store-unit| src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 110ms
 ✓ |store-unit| src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 110ms

 Test Files  66 passed (66)
      Tests  737 passed (737)
   Start at  09:04:40
   Duration  11.57s (transform 5.49s, setup 0ms, collect 18.00s, tests 10.28s, environment 12.03s, prepare 30.48s)
```

#### `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\sessiyaya-basla-240a51
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\sessiyaya-basla-240a51
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
```
