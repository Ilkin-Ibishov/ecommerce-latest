# M1 — fixes before merge

The branch was reviewed twice: an adversarial audit (`docs/audits/m1-variants-ledger-audit.md`) and
an architecture pass. The ledger itself is sound and is not being changed — the database-level
enforcement, the atomicity, the migration on both paths and the role guards all verified clean.

Six items. Commit them separately.

---

## F1 — the stock-adjust endpoint reintroduced the exact race M1 exists to remove  [must]

`artifacts/api-server/src/routes/admin/products.ts`, `PATCH /admin/products/:id/stock`:

```ts
const currentOnHand = Number(variant.on_hand);   // read
const delta = stock - currentOnHand;             // compute
... .from("stock_movements").insert({ quantity_delta: delta })   // write
```

Read, compute, write — with no lock between the read and the write. If anything changes `on_hand` in
between (a customer order, another staff adjustment), the resulting quantity is not the number the
admin asked for. Worse, the handler then returns `{ success: true, stock }` — the *requested* value,
not the actual one — so the error is invisible to the person who caused it.

This is structurally the same defect as the `orders.ts` read-modify-write that the work order cites
as the reason this whole phase exists. It was removed from one route and recreated in another.

The behaviour to preserve: an admin setting an absolute quantity ("make it 30") must end at 30, or
fail loudly. Two directions, both acceptable — argue for one:
- have the endpoint take a delta instead of a target, pushing the arithmetic to the caller who knows
  what it observed, or
- do read, compute and insert inside one Postgres function that locks the variant row for the
  duration, so the computed delta cannot go stale.

Whichever you choose, **return the real resulting quantity**, read back after the write. A response
that echoes the request is a response that cannot report this class of failure.

## F2 — the barcode scan endpoint is unauthenticated  [must]

`artifacts/api-server/src/routes/inventory.ts`, `GET /inventory/scan/:barcode` has no auth
middleware. Any anonymous client can walk barcode numbers and read `on_hand`, `price`, product title
and image for the whole catalogue. Inventory levels and cost-adjacent data are shop-floor
information, not storefront data.

Add the staff/admin guard the other inventory routes use.

## F3 — replace the `barcode` column with a `variant_barcodes` table  [must]

Read `docs/tasks/identification-scenario-matrix.md` first — it is new, and it is the reason for this
change.

The audit marked the partial unique index on `product_variants(barcode)` as correct, and it is
correct against the spec as written. **The spec changed.** A single unique barcode column cannot
represent two scenarios that are ordinary supplier behaviour rather than edge cases:

- several variants sharing one manufacturer code (the same mug in four colours, one EAN)
- one variant carrying several codes (supplier changed packaging; old and new stock sit side by side)

With a unique index, the second colour of that mug simply fails to insert.

Move barcodes to their own table as described in the matrix (`variant_id`, `barcode`, `source`,
`is_primary`), with **no uniqueness on `barcode`**. Decide and justify whether a uniqueness
constraint belongs anywhere at all — for instance on `(variant_id, barcode)`.

The scan endpoint consequently returns a **list**. One match proceeds as today; several return all
matches with enough fields for the operator to choose. The picker UI should be deliberately plain —
no ranking, no learned preferences. That design depends on how many matches actually occur in
practice, which nobody has observed yet.

## F4 — `unit_cost` leaks to staff in movement history  [should]

`GET /api/admin/variants/:id/movements` returns `unit_cost` on every row regardless of role. Staff
can read every goods-receipt cost and derive margin from the selling price, which is the thing
`variant_costs` was separated out to prevent. You enforced this correctly at the variant level and
then let it out through the movement history.

## F5 — staff can post `opening_balance` adjustments  [should]

`POST /admin/stock/adjust` accepts any reason in `VALID_REASONS`, including `opening_balance`. A
staff account can therefore inject an arbitrary opening balance and make the ledger useless for
exactly the purpose the customer named first: noticing when stock goes missing. Opening balances are
an administrative act, not a stock adjustment. Restrict that reason to admin.

While you are there, check the rest of the enum against the role rules — `stocktake_correction` may
deserve the same treatment. Say what you decided.

## F6 — `variant_costs` lifecycle is inconsistent across write paths  [minor]

`POST /admin/products/:id/variants` always creates a `variant_costs` row; the product update path at
`products.ts:158-163` does not, so a variant can exist without one. Make the lifecycle uniform —
either every path that creates or syncs a variant guarantees the row, or the cost read tolerates its
absence. Pick one and apply it everywhere.

---

## Definition of done

Unchanged from the work order, plus the above:

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` all green
- A regression test for F1 that would fail against the current code — interleave an adjustment with
  a concurrent decrement and assert the final quantity, not the response body
- A test that F2's endpoint rejects an unauthenticated request
- Tests covering S1, S2 and S4 from the matrix: one code resolving to one variant, one code resolving
  to several, and one variant reachable by two codes
- State plainly which test tiers you ran and which you could not

Write `docs/audits/m1-fix-notes.md` with what changed per item, anything you disagree with, and the
real command output.
