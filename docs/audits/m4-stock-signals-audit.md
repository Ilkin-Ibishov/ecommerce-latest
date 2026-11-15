# Audit: m4/stock-signals-core
Spec: docs/tasks/warehouse-m4-stock-signals.md   Reviewed: e455ec151b3529713fd209df64f5aad010f5b4e3   Date: 2026-11-15

Branch note: the launch prompt asked for this report on a new branch `audit/m4-stock-signals`. A local
branch of that name already exists and holds an unpushed commit (a3c3b21, "M4 stock signals architect
audit") that is on no other branch; `git checkout -b` refused and overwriting it would have destroyed
that commit. This report is committed on `audit/m4-stock-signals-core`, cut from
`origin/m4/stock-signals-core` at the SHA above.

Inputs not read, per the launch prompt: `docs/design-notes/m4-*.md`, `docs/audits/m4-*.md`,
`docs/audits/m4-blackbox-*`, `prompts/m4-*.md` other than `prompts/m4-audit.md`.

## Verdict
FIX — no cost leak and no ledger corruption, but four majors: non-tracked revenue vanishes from the
margin report, cancelled online orders inflate velocity and hide dead stock, and two screens still turn
"unlimited" into 0 / out of stock.

Severity ranking and reach (one shop, hundreds of SKUs, tens of sales a day):

| # | Severity | Bites in daily use? |
|---|---|---|
| 1 | major | Yes, every day a non-tracked line is sold |
| 2 | major | Yes, for 28 / 90 days after every cancelled online order |
| 3 | major | Yes, every visit to the inventory page and dashboard |
| 4 | major | Yes, every mobile visit to a non-tracked product page |
| 5 | minor | Yes, every counter sale with a non-tracked line (UI only) |
| 6 | minor | Only if someone edits the settings rows |
| 7 | minor | After a restock that follows a stock-out longer than the window |
| 8 | minor | Whenever a sale inside the window was voided |
| 9 | minor | Theoretical: staff token used outside the app, or a race |
| 10 | minor | Theoretical: owner toggles the flag while a receipt posts |
| 11 | minor | Test-quality only |
| 12 | minor | Type-safety only |
| 13 | minor | No runtime effect |

## Findings

### 1. Revenue from a non-tracked line never reaches the margin report  [severity: major]
- Where: supabase/migrations/20261111120800_margin_report_live_schema.sql:36-39 (`movement_sales`
  is the only revenue source of `get_margin_report`); not replaced by any M4 migration. Writers that
  now skip the movement: 20261113231200_m4_post_counter_sale_unified.sql:117-121,
  20261113231100_m4_track_stock_sales_functions.sql:151-158.
- Failing scenario: variant "Gift wrap" has `track_stock = false`, price 3 AZN. A counter sale of
  1 mug (10 AZN) + 1 gift wrap (3 AZN) posts; `counter_sales.total_amount = 13`. No movement is written
  for the gift wrap (correct). `get_margin_report` for that day returns revenue 10 for the mug and no
  row / revenue 0 for the gift wrap: 3 AZN of real revenue is missing from the owner's margin report.
  Same for an online order of a non-tracked variant.
- Invariant or spec clause violated: §9 "A counter sale may include a non-tracked line: it sells, it
  is priced, it reaches the receipt and the **revenue figures**, and it writes no movement."

### 2. A cancelled online order stays in velocity, sales count and dead-stock "sold" forever  [severity: major]
- Where: supabase/migrations/20261113231500_m4_stock_signals_rpcs.sql:195-205 (`tx_net`) and
  117-126 (`trailing_sales`) count only `online_sale` / `counter_sale`; the cancellation reversal is
  written by `increment_stock` (supabase/migrations/20261102100000_m1_variants_ledger.sql:327-331)
  with reason `customer_return` and `reference_id` NULL, called from
  artifacts/api-server/src/routes/admin/orders.ts:80-86 without a reference.
- Failing scenario: variant V, 28-day window. Day 1: online order for 5 units of V → `online_sale -5`
  (reference_id = order id). Day 2: admin sets the order to `cancelled` → `customer_return +5`,
  reference_id NULL. `get_reorder_suggestions` still reports units_sold_window 5, sales_count 1,
  velocity 0.1786/day for V; with two genuine one-unit sales it reaches `has_enough_data = true` and
  suggests `ceil(60 × 7/28 − available)` units, ≈ 11 more than the real demand supports. In
  `get_dead_stock_signals`, a variant whose only "sale" in 90 days was that cancelled order is hidden
  from the not-selling list. The ledger is not self-correcting here because the reversal uses a
  different reason and loses the order reference.
- Invariant or spec clause violated: §5.2 "a ledger-derived velocity is therefore self-correcting";
  §8.1 "computed from stock_movements restricted to outbound sale reasons … A correction is not
  demand" (a cancelled order is not demand either).

### 3. Inventory page and dashboard still derive stock state from the frozen `products.stock`, so the new NULL handling never runs  [severity: major]
- Where: artifacts/store/src/pages/admin/InventoryPage.tsx:123-125 reads `product_variant_availability`
  with the browser (authenticated) client; supabase/migrations/20261113231020_m4_availability_view_track_stock.sql:36-37
  re-revokes that view from `authenticated` (as 20261105200000_m2c_view_security.sql did). The query
  fails, `availRows` is null and every row falls back to `products.stock`
  (InventoryPage.tsx:150-155). `products.stock` is written as 0 at product creation
  (artifacts/api-server/src/routes/admin/products.ts:62) and updated by nothing since M1.
  Dashboard: artifacts/store/src/pages/admin/DashboardPage.tsx:134-137 still renders the old
  "low stock alert" from `products.stock < 10` beside the new signal card.
- Failing scenario: a gift-wrap product created through the admin after M1 with `track_stock = false`.
  The inventory page shows on hand 0, available 0 in red and counts it under "Out of stock"
  (InventoryPage.tsx:190); the dashboard banner lists it as "Out of stock". The same happens to any
  tracked product created after M1 that has 3 units and threshold 10: the signals API reports it low
  (dashboard card says "low: 1"), but the inventory page counts it as out of stock and excludes it from
  the low-stock tab count (InventoryPage.tsx:191-192 requires `available_quantity > 0`). Reserved and
  deficit columns are always 0. Two numbers for the same thing on the owner's landing page.
- Invariant or spec clause violated: §9 "the three-number availability view must not report a
  misleading zero for it"; §6.3 "Report the three numbers that make the signal checkable — on hand,
  reserved, available"; §4 "a stale signal is worse than a slow one".

### 4. Mobile sticky add-to-cart bar shows "Out of stock" for every non-tracked product  [severity: major]
- Where: artifacts/store/src/components/storefront/ProductDetail.tsx:134-136 (`availableStock` falls to
  `product.stock ?? 0`, and ProductPage sets `stock: null` for unlimited) and :468 passes it as `stock`;
  artifacts/store/src/components/storefront/StickyAddToCartBar.tsx:85 `outOfStock = product.stock === 0`.
- Failing scenario: a product whose variant has `track_stock = false`. ProductPage sets
  `available_quantity = availableStock = stock = null`. ProductDetail: `isUnlimited = true`, the main
  button says "In stock", but `availableStock` evaluates to 0. On a phone, scroll past the main
  button: the sticky bar appears with a disabled "Out of stock" button.
- Invariant or spec clause violated: §9 "Availability for a non-tracked variant is unlimited — it is
  never out of stock".

### 5. Counter cart warns "owner must check stock" on every non-tracked line  [severity: minor]
- Where: artifacts/store/src/components/admin/counter/CartLines.tsx:23 (`total > line.on_hand`
  untouched by M4); bundle lines also copy `available: l.on_hand` at
  artifacts/store/src/pages/admin/CounterPage.tsx:60.
- Failing scenario: cashier adds gift wrap (non-tracked, on_hand 0) to the cart. The line shows
  "Sistemdə 0 ədəd var. Satış qeyd olunacaq, sahibkar stoku yoxlamalıdır." The sale then posts
  normally (no movement, not `needs_owner`), so the warning is false and trains staff to ignore the
  warning that does matter.
- Invariant or spec clause violated: §9 "never out of stock".

### 6. The four seeded signal settings are never read; window, target, minimum sales and dead-stock days are hard-coded  [severity: minor]
- Where: supabase/migrations/20261113231300_m4_store_settings_signals.sql:152-156 seeds
  `dead_stock_days`, `reorder_target_days`, `reorder_velocity_window_days`, `reorder_min_sales`; no
  file in artifacts/, lib/ or scripts/ reads those keys. artifacts/api-server/src/routes/admin/inventory-signals.ts:90,92
  hard-codes 90 / 28 / 60 / 3 for the dashboard; :141 and :171-173 default to the same literals.
- Failing scenario: owner sets `reorder_target_days = 30` through `PATCH /admin/settings`. The reorder
  screen and the dashboard count still use 60. The settings rows are dead configuration that looks live.
- Invariant or spec clause violated: §8.2 "`target_days` is a setting, default 60"; §7 "N is a setting
  with a default of 90".

### 7. A variant restocked after a stock-out longer than the window is listed as not selling, with its full capital  [severity: minor]
- Where: supabase/migrations/20261113231500_m4_stock_signals_rpcs.sql:112-116 (`first_receipts` is
  the first movement ever) and :161 (the only day-one floor).
- Failing scenario: variant first received 200 days ago, sold out 120 days ago, 40 units received
  yesterday at 15 AZN. With the 90-day window (or the owner's 30-day choice after any 30-day gap) it
  appears under "not selling" with 600 AZN tied up and "days since last sale 120", although it has
  been on the shelf for one day. The spec's letter (§7) is met; the launch prompt's "received
  yesterday is not dead" is not.
- Invariant or spec clause violated: §12 "Dead-stock days since last sale … Use days since first
  receipt as the floor" — the floor is the first receipt ever, not the receipt that put the current
  stock on the shelf.

### 8. "Days since last sale" counts a voided sale  [severity: minor]
- Where: supabase/migrations/20261113231500_m4_stock_signals_rpcs.sql:127-133 (`lifetime_last_sale`
  takes any negative sale movement, including the original of a voided sale) used at :144-149.
- Failing scenario: variant with no real sale in 120 days; a counter sale 5 days ago was voided.
  `trailing_sales` nets to 0, so the variant is listed as not selling in 90 days, and the same row says
  "days since last sale: 5".
- Invariant or spec clause violated: §7 "Report per variant: … days since the last sale" — the figure
  must be consistent with the verdict it sits next to (§6.3 "An owner who cannot see why something is
  flagged stops trusting the flag").

### 9. The non-tracked reservation guard exists only in Express; the database accepts the reservation and then refuses to fulfil it  [severity: minor, theoretical]
- Where: artifacts/api-server/src/routes/admin/reservations.ts:166-168 is the only check;
  supabase/migrations/20261104180000_m2c_reservations_schema.sql:49-57 ("Reservations: staff insert")
  still lets a staff or admin token insert directly through PostgREST; `fulfil_reservation`
  (20261111110100_m2c_sales_recompute_cost.sql) writes a `counter_sale` movement that ST030 refuses.
  The Express check also races with the `true → false` switch (both read before either commits).
- Failing scenario: staff inserts `reservations(variant_id = gift-wrap, status 'active', …)` via
  PostgREST, or the owner flips `track_stock` while staff creates a deposit. The deposit is recorded and
  paid; "fulfil" fails with ST030 every time, and only a release clears it.
- Invariant or spec clause violated: §9 "rejected in the database, not in the application".

### 10. The movement trigger reads `track_stock` without a lock, so a concurrent switch can let one movement through  [severity: minor, theoretical]
- Where: supabase/migrations/20261113231000_m4_track_stock_movement_trigger.sql:19-21 (plain SELECT);
  the guard in 20261113231010_m4_track_stock_guards.sql:111-115 checks `OLD.on_hand` only.
- Failing scenario: T1 `UPDATE product_variants SET track_stock = false` (on_hand 0, guard passes,
  row locked, not committed). T2 `post_goods_receipt` inserts +10: the trigger's SELECT sees the
  committed `true`, passes, then its `UPDATE … on_hand` waits for T1. T1 commits; T2's update
  re-checks only `on_hand + delta >= 0` and succeeds. Result: a non-tracked variant with on_hand 10 and
  a movement; the receipt can then never be reversed (ST030). Paths that lock the variant first
  (`post_counter_sale`, `decrement_order_stock`) are not affected.
- Invariant or spec clause violated: §9 "A stock movement for a `track_stock = false` variant is
  rejected in the database".

### 11. The staff cost-privacy test passes without checking a row if the fixture is missing  [severity: minor]
- Where: artifacts/api-server/tests/m4-stock-signals.integration.test.ts:120-123 and :131-135
  (`if (staffVar) { … }`, `if (adminVar) { … }`).
- Failing scenario: if `get_dead_stock_signals` stops returning the 100-day-old fixture (for example a
  regression in the day-one floor), the staff and admin per-row assertions are skipped and the test
  stays green; only the absence of `total_dead_capital` is still proven. New test, not a weakened one;
  no test was deleted, skipped or loosened in this diff.
- Invariant or spec clause violated: §16 "A staff-role test proves no cost or value figure reaches a
  staff token, through the API".

### 12. Hand-written database types do not match the migrations  [severity: minor]
- Where: artifacts/supabase-types/src/database.types.ts:2044-2063 — `available_quantity: number`
  (non-null) on both availability views and no `track_stock` on `product_variant_availability`; the
  three signal RPCs are absent from `Functions`, so
  artifacts/api-server/src/routes/admin/inventory-signals.ts:62-70 casts the client to a hand-written
  interface.
- Failing scenario: InventoryPage.tsx:124 dropped its `as any` and is now typed against
  `available_quantity: number`; every `=== null` branch added by M4 is unreachable by the types, so the
  compiler cannot catch a reader that forgets the NULL case (as in finding 4).
- Invariant or spec clause violated: launch prompt hunt 8, "hand-written types that do not match the
  migrations".

### 13. The stocktake guard names a status that does not exist  [severity: minor]
- Where: supabase/migrations/20261113231010_m4_track_stock_guards.sql:120
  (`st.status IN ('draft', 'in_progress')`); the CHECK in
  20261104130000_m2b_stocktake_tables.sql:19 allows only `draft`, `posted`, `cancelled`.
- Failing scenario: none at runtime — `draft` is the only open state, so the guard works. The name is
  invented.
- Invariant or spec clause violated: AGENTS.md "Never invent a name. A column, field, enum value … you
  write must be one you read in the file that defines it".

## Checked and found sound

- **Every movement writer vs. `track_stock`.** `trg_apply_stock_movement` raises ST030 before any
  other branch (diffed against 20261104190000: only the ST030 block added, M2c bypass logic unchanged).
  `post_counter_sale` (diffed against 20261113230400: only the two `track_stock = true` filters
  changed; payments insert kept; the deferred payments constraint trigger stays defined by 230400),
  `post_pending_counter_sale`, `decrement_order_stock`, `void_counter_sale` (each diffed against its
  previous definition) skip non-tracked lines and keep signatures, `SECURITY DEFINER` and the
  service-role-only grants. Goods receipt, receipt reversal, stocktake posting, manual adjustment,
  `fulfil_reservation` and `increment_stock` are not filtered and are refused by ST030 — correct per
  §9; a receipt containing a non-tracked line fails as a whole at posting with a 400. Order
  cancellation of a non-tracked line logs the ST030 and the cancellation still completes.
- **Mixed counter sale.** Tracked line short → ST001 savepoint rolls back all movements, sale is
  `needs_owner`; the non-tracked line is priced and in the total.
- **The switch.** ST031 / ST032 / ST033 fire on true → false only; with a sale holding the row lock the
  guard sees the post-sale `on_hand` (BEFORE trigger runs on the locked latest version). Void after the
  switch writes nothing (accepted decision). Stocktake lines refuse non-tracked variants in the database
  (ST034) and in the route.
- **Velocity.** Voided counter sales net to zero per transaction (void copies `transaction_id` and
  `posting_date`); `needs_owner` lines are counted only while the status is `needs_owner`, and the only
  writer of that status (ST001 path) writes no movement, so no double count; posting from
  `needs_owner` keeps the original posting date. Stocktake corrections, receipts and reversals are
  excluded by reason. Deposit fulfilment (`counter_sale` / `reservation`) counts as a sale. Fractional
  quantities: velocity and `ceil` are numeric throughout.
- **Grants and leaks.** The three RPCs are `SECURITY DEFINER`, revoked from public / anon /
  authenticated and granted to service_role only. Staff get dead stock with `unit_cost`,
  `capital_tied_up` and `total_dead_capital` removed in the route; the summary computes reorder only for
  admin; `/signals/reorder` is `requireAdmin`. No new view; `product_variant_availability` stays
  service-role only; `product_variant_public_availability` exposes NULL for non-tracked (reveals only
  that an item is unlimited). The generated Orval client has no signal endpoints; pages call them with
  `adminFetch`.
- **Low stock.** Non-tracked excluded, reservations reduce `available`, out-before-low ordering, three
  numbers returned. Bundles are not variants (m3_bundles), so they cannot appear. There is no product
  active/archived column in the schema, so §6.2's "active product" filter has nothing to read. The
  RPC defaults the global threshold to 10 when the row is missing instead of "not monitored" (§6.1);
  the row is seeded, so no scenario.
- **Bundles at the counter.** Availability is the minimum over tracked components; all-non-tracked →
  NULL shown as "—".
- **NULL readers that are correct:** `POST /orders` (NULL skips the stock check), `/products/prices`
  + CheckoutPage (NULL branch first), category and related routes, HomePage, ProductsPage (in-stock
  filter includes NULL), ProductCard via `resolveProductStock`, QuickViewModal, counter lookup,
  `/inventory/scan`, reservation creation.
- **No low-stock notification left over.** `low_stock` removed from `NotifType`; nothing queues it.
- **Tests.** No test file deleted, renamed or skipped; no `.skip`, `.only` or raised timeout in the
  diff; `admin-routes.test.ts` only gains the four new routes.

## Checks run

Integration (`api-integration`) and `env-validation` against a database were not run locally (no
database, per the launch prompt); the launch prompt states they ran green in CI run 43736706062. No
Supabase project was touched and no SQL was executed.

typecheck: pass

```
> workspace@0.0.0 typecheck:libs …
> tsc --build
Scope: 5 of 11 workspace projects
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
EXIT 0
```

tests (`pnpm test:unit`): pass

```
 Test Files  67 passed (67)
      Tests  741 passed (741)
   Duration  7.81s
EXIT 0
```

audit:invariants (and `audit:invariants:strict`): pass

```
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
EXIT 0
```

Note on the invariants: `no-non-tracked-variant-movements` is a text-presence check on four function
bodies; it would not catch a new writer (the ST030 trigger does). Findings 1–4 are not expressible by
the current checks.
