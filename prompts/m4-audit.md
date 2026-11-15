# Launch prompt — M4 audit

Act as the `auditor` agent defined in `.agents/agents/auditor.md`. Read that file first and follow
it exactly, including the rule that you fix nothing.

## Your inputs

- Spec: `docs/tasks/warehouse-m4-stock-signals.md`
- Invariants: `.agents/rules/inventory.md`, `.agents/rules/migrations.md`, and the checks in
  `scripts/audit/check-invariants.mjs`
- Branch under review: `m4/stock-signals-core` (remote `origin/m4/stock-signals-core`)
- Diff: `git diff main...origin/m4/stock-signals-core`

**Do not read** `docs/design-notes/m4-*.md`, `docs/audits/m4-*.md`, `docs/audits/m4-blackbox-*`,
or any `prompts/m4-*.md` other than this one. They hold the implementer's and the architect's
reasoning; this audit exists to catch what both missed.

## Decisions taken — not findings

- **No low-stock notification in M4.** The `low_stock` notification type is removed, nothing is
  evaluated on sale. The dashboard count and the inventory filter are the daily summary.
  Spec §6.4 is superseded by this. A missing notification is not a finding; a leftover one is.
- **A void after `track_stock` true → false writes no movement.** `void_counter_sale` reverses only
  tracked lines; the movement trigger has no exception. `on_hand` stays where it was. Accepted.
- **The reservation guard on the switch is `status = 'active'`, with no expiry test.**
- **Velocity** counts ledger sale movements, plus `counter_sale_lines` of sales in `needs_owner`
  (spec §5.2, corrected).
- The seven `20261113231xxx` migrations are already applied to the test project. Findings in them
  are still findings — the fix would be a new migration.

## What this phase is

Three read-time signals — low stock, dead stock, reorder suggestions — computed from the ledger and
current state, never stored (spec §4). Plus a defect fix: `product_variants.track_stock = false`
must mean no stock is tracked — the database refuses movements, sales still sell, availability is
unlimited (spec §9).

## What to hunt for

One of these with a concrete sequence beats twenty observations.

1. **`track_stock` through a door nobody guarded.** Every writer of `stock_movements` — online
   order decrement, counter sale (posted, pending, `needs_owner` posted later), void, goods receipt
   and its reversal, stocktake posting, reservation fulfilment, manual adjustment. Find a path that
   moves stock for a non-tracked variant, or one that fails a legitimate sale because a line is
   non-tracked. Then the switch itself: true → false with stock, with an open stocktake, with an
   active reservation, concurrently with a sale.
2. **"Unlimited" read as a number.** Non-tracked availability is `NULL`. Find every reader of the
   availability view and of its columns — storefront list, product page, cart, checkout, order
   route, counter lookup, bundle availability — and the one that turns `NULL` into 0 (out of stock)
   or into a comparison that is always false. Follow the value, not the column name: it travels as
   `available`, `available_quantity` and `stock`.
3. **Velocity double-counted or lost.** A `needs_owner` sale counted from its lines and again after
   it posts; a void that leaves velocity up; a stocktake shrinkage or a receipt reversal counted as
   demand; a sale exactly at the window edge; fractional quantities.
4. **Signals that leak.** Staff must get low stock and dead stock without `unit_cost`,
   `capital_tied_up` or any value; reorder is admin-only. Check the routes, the RPCs' grants
   (`SECURITY DEFINER`? callable by `authenticated` — which here includes every shopper?), the views'
   `security_invoker`, and what the generated client and the admin pages receive.
5. **Dead stock on day one.** A variant entered by opening count or received yesterday is not dead.
   Construct the case that lists it anyway, or hides a really dead one.
6. **Bundles.** A bundle holds no stock; its components do. A bundle with a non-tracked component.
7. **Silenced tests.** Diff the test files: deleted, `.skip`, loosened assertions, raised timeouts.
8. **Generated code edited by hand**, and hand-written types that do not match the migrations.

## Output

Write `docs/audits/m4-stock-signals-audit.md` in the auditor format and commit only that file, on a
new branch `audit/m4-stock-signals` cut from `origin/m4/stock-signals-core`. Do not push.

Every finding needs a concrete failing scenario. Rank by severity and say which ones will bite in a
shop with hundreds of SKUs and tens of sales a day and which are theoretical.

**Work directly. Do not spawn subagents.** Do not touch any Supabase project or run SQL against one;
read the migrations. Run `pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants`
(install with `pnpm install --frozen-lockfile` first if `node_modules` is missing) and report the
real output. Integration tests need a database; they ran green in CI run 43736706062 on this branch.
