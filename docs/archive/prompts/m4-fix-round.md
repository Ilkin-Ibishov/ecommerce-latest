# Phase M4 — fix round on the split branch

Read, in this order: `AGENTS.md`; the spec `docs/tasks/warehouse-m4-stock-signals.md`;
`docs/audits/m4-architect-audit.md` (all of it, including both "Split" sections);
`docs/design-notes/m4-stock-signals.md`; `docs/audits/m4-design-note-review.md`. Do not edit the spec,
the audits or the review.

**The review's decisions D1–D6 are binding. Where the design note and the review differ, the review
wins.** If you believe a decision is wrong, say so in your notes and implement it anyway.

Work on branch `m4/stock-signals-core`; it is checked out. Never commit to `main`. Do not use
`m4/stock-signals`. Do not touch any Supabase project, by MCP, CLI or script: **you cannot run SQL in
this round**, so write it plainly, re-read every statement against the function or view it replaces,
and do not claim any of it has executed. A human applies the migrations to the test project after
this round.

Eight items, one commit each, in this order. Nothing else: do not refactor nearby code.

## 1. Migrations (audit B2, B3; review D2, D3, D5)

Delete the five M4 migrations on the branch (`20261113220000`, `…220010`, `…220100`, `…220200`,
`…220300`). None was ever applied anywhere. Replace them with, in this order:

| File | Content |
|---|---|
| `20261113231000_m4_track_stock_movement_trigger.sql` | `trg_apply_stock_movement` raises ST030 for a `track_stock = false` variant. **No exception of any kind** (D2). The existing negative-stock and availability branches stay exactly as they are. |
| `20261113231010_m4_track_stock_guards.sql` | The true → false guard on `product_variants` (`BEFORE UPDATE OF track_stock`): ST031 `on_hand <> 0`, ST032 on an open stocktake, ST033 any reservation with `status = 'active'` — **no `expires_at` test** (D3). The `stocktake_lines` insert guard, ST034. |
| `20261113231020_m4_availability_view_track_stock.sql` | `CREATE OR REPLACE VIEW product_variant_availability` with the eight existing columns in their existing order and `track_stock` **last**. `available_quantity` is `NULL` when not tracked. No `DROP VIEW`. |
| `20261113231100_m4_track_stock_sales_functions.sql` | `post_pending_counter_sale`, `decrement_order_stock` and `void_counter_sale` write movements only for `track_stock = true` lines. **Not** `fulfil_reservation` (D3). **Not** `post_counter_sale`. |
| `20261113231200_m4_post_counter_sale_unified.sql` | The one definition of `post_counter_sale`: copy `20261113230400_post_counter_sale_payments.sql`'s function body and add only the `track_stock = true` filter on the movement insert and the cost loop. The `counter_sale_payments` insert stays where it is. |
| `20261113231300_m4_store_settings_signals.sql` | The four signal settings. **No `owner_notification_phone`** (D1). |
| `20261113231500_m4_stock_signals_rpcs.sql` | The three RPCs, revoked from `public, anon, authenticated`, granted to `service_role`. |

For every function you replace: start from its **latest** definition in `supabase/migrations/`, change
only what this table says, keep its signature, `SECURITY DEFINER` setting and grants, and name the
source file in your notes. There is no `low_stock_notification_events` table and no
`evaluate_low_stock_digest` (D1).

While in the RPC file, fix three audit minors:
- **m2.** `has_enough_data` counts transactions with net units > 0, so a fully voided sale does not count.
- **m3.** The supplier group for a variant with no supplier is `NULL`, not the literal `'Unassigned'`;
  the label comes from `t()` in the three dictionaries.
- **m4.** Keep `needs_owner` sales out of the ledger-based velocity exactly as the code does now; do
  not change it. (The spec is being corrected by the architect.)

Before writing the stocktake guard, read `post_stocktake` and state in your notes what it does with
tracked variants that are absent from the count sheet (D6). If it writes a correction for them, it
must skip non-tracked variants; make that change in `…231100` and say so.

## 2. Remove the low-stock notification (review D1)

Remove the `low_stock` member from the notification type in `artifacts/api-server/src/lib/notifications.ts`
and its dispatch branch; remove the `in_app` channel if nothing else uses it; remove the
`evaluate-digest` route from `routes/admin/inventory-signals.ts`. Grep first: `low_stock` also appears
as a stock *status* label in UI files (`ProductsPage.tsx`, `OrderDetailPage.tsx`, `admin-logic.test.ts`)
— that is something else, leave it. You may delete the tests that exercise the digest endpoint and the
suppression table, and only those; name each deleted test in your notes.

## 3. `NULL` availability at every reader (audit m1; review D4)

Handle `available_quantity === null` as unlimited, or exclude the row, in every file the review's D4
lists. `Number(null)` is `0`: a reader left alone shows an unlimited item as out of stock. Remove the
literal `999999` everywhere. Frontend files: follow `AGENTS.md` — run `modern-web-guidance` `search`
and `retrieve` first.

## 4. The two unimplemented spec §9 bullets

Bundle availability is the minimum over *tracked* components (`routes/admin/counter-lookup.ts`, and
the counter page where it shows availability). A non-tracked variant is refused on a stocktake sheet
in the route with a 400, in addition to the database guard. A reservation for a non-tracked variant is
refused in `routes/admin/reservations.ts` with a 400.

## 5. `as any` (audit M4)

`AGENTS.md` forbids it. Remove every `as any` this branch added in `DashboardPage.tsx` (16),
`InventoryPage.tsx` (1) and `routes/admin/inventory-signals.ts` (10): type the values. Validate RPC
results with a Zod schema at the route, as the rest of the API does at its boundaries. The one
permitted remainder: a cast on the Supabase client that exists only because `database.types.ts` does
not yet know a new RPC or column — types are regenerated after the migrations are applied. List each
such cast in your notes with file and line. Same rule for the 23 in
`tests/m4-stock-signals.integration.test.ts`. Add none.

## 6. Invariants

In `scripts/audit/check-invariants.mjs`, in the shape of the existing checks, each with fixture tests
beside the other `invariant-*.test.ts` files:

- Update `no-non-tracked-variant-movements` to also require the `track_stock` filter in the latest
  definition of `void_counter_sale`, and stop requiring it of `fulfil_reservation`.
- `signals-have-one-derivation`: no file under `artifacts/api-server/src/lib/` named
  `inventory-signals*`, and no empty `catch` in `routes/admin/inventory-signals.ts` (audit M1).
- `no-undispatched-notification-type`: every member of the notification type union in
  `lib/notifications.ts` has a dispatch branch (spec §6.4).

## 7. Tests

Integration tests (`artifacts/api-server/tests/m4-stock-signals.integration.test.ts`; they run in CI
only, after the migrations are applied — do not claim they passed):

- a movement for a non-tracked variant is refused with ST030;
- true → false is refused with ST031, ST032 and ST033 in turn, and allowed when all three are clear;
- a non-tracked variant is refused on a stocktake line (ST034);
- a counter sale with a non-tracked line posts, writes its `counter_sale_payments` row and writes no
  movement for that line;
- a sale of a tracked variant, then the switch to non-tracked, then `void_counter_sale`: the void
  succeeds and writes no movement;
- the availability view returns `NULL` `available_quantity` and `track_stock = false` for it;
- none of the three RPCs returns a non-tracked variant; `anon` and `authenticated` cannot execute them;
- one real sale plus two fully voided ones: `has_enough_data` is false.

Assert `error` on every setup call. Unit tests for any `NULL`-handling logic you can extract as a pure
function. Do not skip or delete any test other than those named in item 2.

## 8. Notes

Write `docs/audits/m4-implementation-notes.md` (spec §16): what changed per item; the source file of
each replaced function; the D6 answer; every remaining client cast; every deleted test; the real
output of `pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants`; and a plain statement
that no SQL was executed and the integration tier was not run. If any finding or decision turns out to
be wrong against the code, stop on that item, say so there, and do not guess a different fix.

## Done means

`pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants` pass — including
`post-counter-sale-writes-payments` and `no-non-tracked-variant-movements`, which fails on this branch
today. No new file over 200 lines without the reason in your notes. No `@ts-ignore`, no new `as any`,
no `.skip()`.
