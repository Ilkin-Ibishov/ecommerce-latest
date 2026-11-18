# M2a — implement

The revised design note is **approved**. R1–R7 and the minors are resolved, and several are resolved
better than the review asked for:

- **R1** — naming the three sets explicitly (carried-forward, deleted, replayed) and proving them
  disjoint is the right way to settle a boundary bug, and the inductive proof of partial-replay
  equivalence is now the theorem the implementation will actually be tested against. Storing
  `created_at` on `stock_movement_costs` so the projection reproduces its own ordering key — rather
  than joining back to `stock_movements` — is the better of the two options and your reasons are
  correct.
- **R2** — the upsert, and saying what guarantees a row exists.
- **R3** — the staff policy set now matches the workflow it was written for.
- **R4** — resolving the original sale movement through `(reference_type, reference_id)` with the
  strict ordering predicate, and falling back to the current average **explicitly** rather than
  silently, is exactly the distinction that was missing.
- **R5** — dropping `stock_movements.unit_cost` outright closes the leak, and `variant_costs.
  opening_cost` gives opening balances a carrier that stays admin-only. Good.
- **Q2 refinement** — moving `additional_costs` off `goods_receipts` into an isolated admin-only
  table, because RLS governs rows and not columns, is a sharper application of M1's own lesson than
  the review's wording. Adopted.

Proceed to implementation on this branch, following your three-migration plan.

---

## One defect to fix before you build the margin report

The time axis is now unified, but **revenue is still derived at the wrong granularity**, and the
error is not a rounding detail.

```sql
WHEN ms.reason = 'customer_return' AND ms.reference_type = 'order' THEN -COALESCE(oi.line_total, 0)
```

`line_total` is the total for the whole order line. A customer who returns **one** unit of a
three-unit line produces a `customer_return` movement with `quantity_delta = 1`, and this expression
subtracts the revenue of all three. COGS is per-unit correct, because it comes from
`smc.total_cost`; revenue is not. The margin on that variant is then wrong, in the direction of
looking like a loss — on the one number this entire phase exists to produce.

The same granularity mismatch bites a partially fulfilled or partially cancelled order, where one
order line can correspond to more than one movement: each movement joins the same `order_items` row
and claims the full line revenue.

And there is a fan-out hazard underneath it: `order_items` has **no unique constraint** on
`(order_id, variant_id)`. Two rows for the same variant in one order make the join multiply both
revenue *and* COGS.

Fix all three with one change: derive a **unit** price per `(order_id, variant_id)` and multiply it
by the movement's own quantity.

- Aggregate `order_items` to one row per `(order_id, variant_id)` before joining — summing
  `line_total` and `quantity`, so a weighted unit price is `SUM(line_total) / SUM(quantity)`. This
  removes the fan-out by construction rather than by assuming a constraint that does not exist.
- Revenue for a movement is that unit price multiplied by `ABS(quantity_delta)`, signed by reason as
  you already do.
- `product_price_snapshot` is also on `order_items` and may look like the simpler source. Prefer the
  aggregate: the snapshot is the pre-discount unit price, so a discounted line would report revenue
  the shop never received.

**Required test:** a three-unit sale followed by a one-unit return must leave the report showing
two units, two units of COGS, and two units of revenue. Not one line's worth of either.

## Two things to carry into the invariant checker

Beyond the `no-cost-column-on-staff-tables` check your note already specifies:

- `rebuild_on_hand` bypasses M1's `on_hand` guard through
  `current_setting('inventory.allow_on_hand_repair')`. That is an acceptable mechanism and your
  concurrency reasoning for it holds — but the guard is now only as strong as the number of places
  that can set that setting. Add a check that **no file outside the repair function's own migration
  sets or references that setting**, and name the setting in `.agents/rules/inventory.md` so the
  next phase does not reach for it casually.
- The ledger-versus-projection divergence that R1 would have produced is exactly what
  `verify_stock_integrity()` should be able to report. Make sure it covers both divergences — ledger
  sum versus `on_hand`, and projection `running_quantity` versus ledger sum — and add a test that
  deliberately corrupts each one and asserts the function reports it.

## How to work

Commit per logical step, not per migration — a reviewer should be able to read one migration, or one
route, on its own. Migrations land before the routes that use them, so `main` stays deployable at
every commit as your plan promises.

Order the work so the costing engine is provable before any UI sits on it: schema, then
`recompute_variant_cost` with its tests, then posting and reversal, then routes, then UI, then the
margin report. If the replay is wrong, everything built on it has to be re-verified.

## Definition of done

From work order §13, unchanged:

- `pnpm run typecheck` green
- `pnpm run test:unit` green
- `pnpm run audit:invariants:strict` green with an **empty** baseline — no new violations parked
- `main` deployable at every commit on this branch
- Every deliverable in §12 of the work order exists, or your notes say why it should not

The tests your own note commits you to are part of done, not a follow-up:

- **partial replay equals full replay** — the theorem from §2, as a property test over interleaved
  receipts, sales, returns and a backdated receipt
- **atomic posting** — a receipt whose last line fails writes no movements at all
- **backdated receipt** changes the valued cost of an already-posted sale
- **staff token reaches no cost** — through PostgREST directly, not through Express
- **opening balance with no `opening_cost`** is excluded from the average, not averaged as zero
- **partial return revenue**, per the section above
- **integrity checks** report each corruption they are meant to catch

## What you cannot verify locally, and must not claim

`api-integration` needs Supabase credentials and a running API server; it runs in CI only, and the
M2a migrations have not been applied to any remote database yet. Write those tests, run what you
can, and state plainly which tiers you actually executed. A claim that integration tests passed
locally is a claim I will check.

Do not run migrations against any remote Supabase project. Local or branch database only.

## Notes

Write `docs/audits/m2a-implementation-notes.md`: what changed per migration, anything you found that
contradicts the design note, what you chose not to do, and the real output of the three commands
above.
