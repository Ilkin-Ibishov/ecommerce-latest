# Phase M4 — fix round 4

Read `AGENTS.md`, `.agents/rules/migrations.md` and `.agents/rules/testing.md`. Branch
`m4/stock-signals-core`; it is checked out. Never commit to `main`. Do not touch any Supabase project
and do not run SQL. **Do not edit any existing file under `supabase/migrations/`** — they are applied
to the test project. Every database change is a **new** migration file.

An adversarial audit found four defects (`docs/audits/m4-stock-signals-audit.md`, findings 1–4).
Four changes, one commit each. Nothing else.

## 1. Non-tracked sales are missing from the margin report

`get_margin_report` (live definition: `supabase/migrations/20261111120800_margin_report_live_schema.sql`)
builds revenue from `stock_movements` only. Since M4 a non-tracked line writes no movement, so a
counter sale of a mug (10.00, tracked) and gift wrap (3.00, `track_stock = false`) reports 10.00.

New migration `supabase/migrations/20261116100000_m4_margin_report_non_tracked.sql`:
`CREATE OR REPLACE FUNCTION public.get_margin_report` with the **same signature, `RETURNS TABLE`,
`SECURITY DEFINER`, and the same `REVOKE`/`GRANT` lines** as the live file. Copy the live body verbatim
and change only this:

- Add a CTE `non_tracked_lines (variant_id, units, revenue)` = `UNION ALL` of
  - `counter_sale_lines l` joined to `counter_sales cs` on `cs.id = l.sale_id`, `cs.status = 'posted'`,
    `cs.posting_date >= p_start_date AND cs.posting_date < p_end_date`; units `l.quantity`, revenue
    `l.net_line_total`;
  - `order_items oi` joined to `orders o` on `o.id = oi.order_id`,
    `o.status NOT IN ('cancelled', 'refused_at_delivery')`,
    `o.created_at >= p_start_date AND o.created_at < p_end_date`; units `oi.quantity`, revenue
    `oi.line_total`;
  - both restricted to `product_variants.track_stock = false` **and** to lines with no stock movement
    for that sale and variant (`NOT EXISTS` on `stock_movements` with `transaction_id = cs.id` for the
    counter sale, `reference_type = 'order' AND reference_id = o.id::text` for the order). The second
    condition stops a sale made while the variant was still tracked from being counted twice.
- Fold those rows into `aggregated_metrics` with COGS **0**: units into `net_units_sold`, revenue into
  `total_revenue`, nothing into `unpriced_units_out`. A non-tracked item has no cost of goods; its
  margin is its price.

## 2. A cancelled order stays in velocity and in "last sold"

Cancelling an order restocks through `increment_stock`, which writes reason `customer_return`,
`reference_type = 'order'`, `reference_id = p_reference_id`
(`20261102100000_m1_variants_ledger.sql:308-331`). Today no caller passes `p_reference_id`, so it is
NULL, and `get_reorder_suggestions` / `get_dead_stock_signals` count only `online_sale` and
`counter_sale`. A cancelled 5-unit order keeps velocity up for 28 days.

- `artifacts/api-server/src/lib/rpc.ts:73` `incrementStock`: add an optional 4th parameter
  `referenceId?: string`, passed as `p_reference_id`. All four callers pass the order id:
  `routes/admin/orders.ts:83` (the order being cancelled) and `routes/orders.ts:162, 199, 222` (the
  order whose insert is being rolled back). An online sale movement has `reference_id = order id`
  and `transaction_id` NULL (`20261113231100_m4_track_stock_sales_functions.sql`, `decrement_order_stock`),
  so the return now groups with its sale under `COALESCE(transaction_id::text, reference_id)`.
- New migration `supabase/migrations/20261116100100_m4_signals_net_order_returns.sql`:
  `CREATE OR REPLACE` `get_reorder_suggestions` and `get_dead_stock_signals`, each copied verbatim from
  `20261113231500_m4_stock_signals_rpcs.sql` with its `REVOKE`/`GRANT` lines. Change only:
  - `get_reorder_suggestions`, CTE `tx_net` (line 201): the filter becomes
    `sm.reason IN ('online_sale', 'counter_sale') OR (sm.reason = 'customer_return' AND sm.reference_type = 'order')`
    (parenthesise it against the date condition). The existing `HAVING … > 0` then drops a fully
    cancelled order.
  - `get_dead_stock_signals`, CTEs `trailing_sales` and `lifetime_last_sale` (lines 117-133): compute
    both from transactions netted the same way — group sale movements and order returns by
    `(variant_id, COALESCE(transaction_id::text, reference_id))`, keep transactions whose net units are
    `> 0`, and take `MAX(posting_date)` of their **sale** movements. A voided counter sale nets to zero
    the same way, so "days since last sale" no longer names a voided sale.
  - `get_low_stock_signals` does not change; do not redefine it.

## 3. The inventory page reads a view it is not allowed to read

`artifacts/store/src/pages/admin/InventoryPage.tsx` queries `product_variant_availability` with the
browser client. `authenticated` has no `SELECT` on that view
(`20261105200000_m2c_view_security.sql:10`, `20261113231020_m4_availability_view_track_stock.sql:36`),
so the query returns nothing and the page falls back to `products.stock`, which is 0 for every product
created since M1. The low-stock filter on that page is therefore wrong.

- Add `GET /admin/inventory/availability` to `artifacts/api-server/src/routes/admin/inventory-signals.ts`,
  `requireStaffOrAdmin`, after the four signal routes. It selects `product_id, on_hand,
  reserved_quantity, available_quantity, deficit_quantity` from `product_variant_availability` with the
  service client and returns `{ rows }`. Zod-validate the rows with `safeParse` like the other routes in
  the file; `available_quantity` is nullable (unlimited), the other three are `z.coerce.number()`.
- `InventoryPage.tsx`: replace the browser query with `adminFetch(apiUrl("/admin/inventory/availability"))`;
  keep the aggregation code that follows it unchanged.
- `artifacts/api-server/tests/admin-routes.test.ts`: add `"GET /admin/inventory/availability"` after
  `"GET /admin/inventory/signals/reorder"` (that file's own registration order). The expected count
  rises by one.

## 4. The mobile add-to-cart bar says "out of stock" for unlimited items

`artifacts/store/src/components/storefront/ProductDetail.tsx:133-136` turns an unlimited item
(`available_quantity === null`) into `product.stock ?? 0` and passes it to `StickyAddToCartBar`
(`:461-468`), which shows "out of stock" when `stock === 0`
(`StickyAddToCartBar.tsx:85`).

- Pass `stock: isUnlimited ? null : availableStock` to `StickyAddToCartBar` only.
- `StickyAddToCartBar.tsx`: type the prop `stock: number | null`. `outOfStock = product.stock === 0`
  is then already right for `null`. Change nothing else in either file.

## Tests

- Item 1 — `artifacts/api-server/tests/m4-track-stock.integration.test.ts`, new case after test 4,
  reusing that test's helpers: a counter sale with one tracked and one non-tracked line, then
  `get_margin_report` over a range containing it. Assert the non-tracked variant's row has
  `revenue` = its line's `net_line_total`, `cogs` = 0, `units_sold` = its quantity; the tracked row is
  unchanged.
- Item 2 — `artifacts/api-server/tests/m4-stock-signals.integration.test.ts`, new case: call
  `decrement_order_stock` for an order id and a variant, then `increment_stock` with the same quantity
  and `p_reference_id` = that order id; `get_reorder_suggestions` with a large `p_target_days` returns
  the variant with `sales_count` 0 (or does not return it — assert whichever the function's `WHERE`
  produces, after reading it).
- Item 1–2 unit — `artifacts/store/src/__tests__/invariant-stock-signals-schema.test.ts` parses
  `20261113231500_m4_stock_signals_rpcs.sql`. Point it at the newest migration that defines each
  function (read the files; do not guess), so the schema check follows the live definition.
- You cannot run the integration tier. Write the setup from the table constraints:
  `counter_sales`/`counter_sale_lines` are written only by `post_counter_sale` — use the test file's
  existing way of creating a sale. `stocktakes` needs `stocktake_number` (unique) and `title`;
  `reservations` needs `reservation_number` (unique) and `agreed_price`.

## Notes

Append a "Round 4" section to `docs/audits/m4-implementation-notes.md`: what changed per item, every
test added, the real output of `pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants`,
and that the integration tier was not run by you. If a line number or name above is wrong against the
code, stop on that item and say so.

## Done means

The three local commands pass. No `@ts-ignore`, no new `as any`, no `.skip()`, no deleted test, no
edited existing migration.
