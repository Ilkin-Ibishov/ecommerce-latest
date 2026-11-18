# Phase M4 — fix round 3

Read `AGENTS.md`, then `docs/audits/m4-architect-audit.md` section "CI — run 43682778875".
Branch `m4/stock-signals-core`; it is checked out. Never commit to `main`. Do not touch any Supabase
project and do not run SQL. Do not edit the spec, the audits or the review. Do not edit any file
under `supabase/migrations/`: the seven M4 migrations are applied to the test project and are correct.

The integration tier ran for the first time and eight tests failed. The causes are known exactly.
Four changes, one commit each. Nothing else.

## 1. C1 — the route's Zod schemas do not describe what the RPCs return

`artifacts/api-server/src/routes/admin/inventory-signals.ts`. The three schemas name fields that do
not exist (`reorder_point`, `lead_time_days`, `daily_velocity`, `recommended_qty`,
`preferred_supplier_name`) and omit most that do, so `.parse()` throws and all four routes answer
500. Replace each schema with exactly the columns of the function's `RETURNS TABLE` in
`supabase/migrations/20261113231500_m4_stock_signals_rpcs.sql`, same names, same order:

- `get_low_stock_signals`: `variant_id`, `product_id`, `product_title`, `variant_sku`, `barcode`,
  `unit_of_measure`, `on_hand`, `reserved_quantity`, `available_quantity`, `threshold`, `status`.
- `get_dead_stock_signals`: `variant_id`, `product_id`, `product_title`, `variant_sku`, `barcode`,
  `unit_of_measure`, `on_hand`, `days_since_last_sale`, `days_since_first_receipt`, `unit_cost`,
  `capital_tied_up`.
- `get_reorder_suggestions`: `variant_id`, `product_id`, `product_title`, `variant_sku`, `barcode`,
  `unit_of_measure`, `supplier_id`, `supplier_name`, `supplier_contact`, `on_hand`,
  `reserved_quantity`, `available_quantity`, `units_sold_window`, `sales_count`, `velocity`,
  `days_of_cover`, `suggested_qty`, `has_enough_data`.

Rules: quantities are `numeric(12,3)` and can be fractional — `z.coerce.number()`, never `.int()`.
Nullable: `product_title`, `variant_sku`, `barcode`, `unit_of_measure`, `supplier_id`,
`supplier_name`, `supplier_contact`, `days_of_cover`, `suggested_qty`. `sales_count` and the two
`days_since_*` are integers. The admin pages (`ReorderPage.tsx`, `InventoryPage.tsx`,
`DashboardPage.tsx`) already read the RPC's real names; do not change them unless a field they read
is missing from the list above — if so, stop and say so.

A throw from `.parse()` must not become an unhandled rejection: use `safeParse` and answer 500 with
a fixed message, logging the Zod issues with the request logger. The staff path still strips
`unit_cost` and `capital_tied_up`.

Add a unit test (store-unit project, beside the other `invariant-*.test.ts`) that reads the migration
file and the route file as text and fails unless each schema's keys equal its function's
`RETURNS TABLE` column names, in order. This is what would have caught the defect offline.

## 2. C2 — the admin route inventory

`artifacts/api-server/tests/admin-routes.test.ts` holds the expected list of admin routes (84). The
router now registers 88: the four `GET /admin/inventory/signals/{summary,low-stock,dead-stock,reorder}`
routes. Add them to the expected list at their true position in registration order — read
`routes/admin/index.ts` (or wherever the admin router is assembled) for the order; do not guess.

## 3. C3 — three test-setup errors in `tests/m4-track-stock.integration.test.ts`

- Lines 86 and 113: the `stocktakes` insert omits two `NOT NULL` columns. Add
  `stocktake_number` (unique: use the same stamp the file uses for SKUs) and `title`.
- Line 175: `.eq("reason", "counter_sale_void")` — that enum value does not exist (22P02). A void
  writes `reason = 'counter_sale'` with `note = 'void'` (`void_counter_sale`). Filter on
  `.eq("note", "void")`.
- Check the valid `stocktakes.status` values against the `CHECK` in
  `20261104130000_m2b_stocktake_tables.sql` and any later migration that alters it, and use one
  that exists.

## 4. C4 — test 4 in `tests/m4-stock-signals.integration.test.ts`

"one real sale plus two fully voided ones": the variant has 10 on hand and one unit sold in 28
days, so its cover is about 250 days and `get_reorder_suggestions` rightly leaves it out with
`p_target_days: 60`; the test then finds no row. Call the RPC with `p_target_days: 100000` so the
variant is returned, and keep both assertions (`item` is defined; `has_enough_data` is false). Also
assert `sales_count` is 1.

## Notes

Append a "Round 3" section to `docs/audits/m4-implementation-notes.md`: what changed per item, and
the real output of `pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants`. State
plainly that the integration tier was not run by you. If a finding is wrong against the code, stop
on that item and say so; do not guess a different fix.

## Done means

The three local commands pass. No `@ts-ignore`, no new `as any`, no `.skip()`, no deleted test.
