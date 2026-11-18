# Phase M4 — fix round 2

Read `AGENTS.md`, then `docs/audits/m4-architect-audit.md` section "Fix round 1 — verification".
Branch `m4/stock-signals-core`; it is checked out. Never commit to `main`. Do not touch any Supabase
project and do not run SQL. Do not edit the spec, the audits or the review.

Five small, exact changes, one commit each. Nothing else: do not refactor nearby code.

## 1. R1 — the view's column type

`supabase/migrations/20261113231020_m4_availability_view_track_stock.sql`: the `available_quantity`
expression must be `numeric(12,3)`, as it is today. Postgres gives a `CASE` with a bare `NULL` arm
no typmod and then refuses the replace (42P16). Cast the whole expression:

```sql
(CASE WHEN pv.track_stock = false THEN NULL
      ELSE GREATEST(0, pv.on_hand - COALESCE(r.active_reserved, 0)) END)::numeric(12,3) AS available_quantity,
```

Change nothing else in the file.

## 2. R2 — ambiguous column references in two RPCs

`supabase/migrations/20261113231500_m4_stock_signals_rpcs.sql`: in a `RETURNS TABLE` plpgsql function
every output column name is a variable, so an unqualified `variant_id` or `status` inside the body
raises 42702 at the first call. In `get_low_stock_signals` and `get_reorder_suggestions`, alias every
table in every subquery and CTE and qualify every column reference — in particular the reservations
subquery:

```sql
SELECT res.variant_id, SUM(res.quantity) AS reserved
FROM public.reservations res
WHERE res.status = 'active' AND (res.expires_at IS NULL OR res.expires_at > now())
GROUP BY res.variant_id
```

Then re-read all three functions name by name against their `RETURNS TABLE` lists (`variant_id`,
`product_id`, `barcode`, `on_hand`, `status`, `supplier_id`, `velocity`, …) and qualify any other
bare use. List each line you changed in the notes. Do not change what the functions compute.

## 3. R3 — restore the three deleted tests

In `artifacts/api-server/tests/m4-stock-signals.integration.test.ts`, bring back from
`git show f4b129d:artifacts/api-server/tests/m4-stock-signals.integration.test.ts`:

- the `decrement_order_stock` assertion of old test 2 (an order line for a non-tracked variant
  completes and writes no movement);
- old test 3 (staff receive no `unit_cost`, `capital_tied_up` or `total_dead_capital` from
  `/admin/inventory/signals/dead-stock`);
- old test 5 (reorder evidence fields; staff get 403 on `/admin/inventory/signals/reorder`).

Adapt setup to the current file's helpers; keep every assertion. Add no `as any` beyond the client
casts the notes already list. If the file passes 300 lines, split it by concern into a second
`*.integration.test.ts` beside it.

## 4. R4 and R5 — `stock` for a non-tracked product

- `artifacts/store/src/pages/storefront/CheckoutPage.tsx` (the `/products/prices` effect): when
  `server.available === null` the item is unlimited — do not remove it and do not clamp its
  quantity; still apply a price change. Frontend file: run `modern-web-guidance` `search` and
  `retrieve` first, per `AGENTS.md`.
- `artifacts/api-server/src/routes/products.ts` and `routes/categories.ts`: remove the two
  `p.stock = val as any`. Do not write `null` into `stock`. Leave `stock` as it was when
  availability is `null` and carry the `null` only in `available_quantity`.
- Then grep `artifacts/store/src` for every reader of `.stock` on a product that came from those
  three endpoints (product card, related products, category grid). For each, say in the notes what
  it shows for `available_quantity === null` with `stock === 0`, and fix any that shows "out of
  stock" or disables add-to-cart. Extract the decision as one pure function if two or more
  components need it, and unit-test it.

## 5. Notes and the dead comparison

- `ReorderPage.tsx:113`: remove the comparison with the literal `"Unassigned"`.
- In `docs/audits/m4-implementation-notes.md`: correct the §3 source table to the files the
  migration headers name; correct §6 to list every test deleted in round 1 and say they are
  restored; add a "Round 2" section with what changed per item and the real output of
  `pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants`.

If a finding turns out to be wrong against the code, stop on that item, say so in the notes, and do
not guess a different fix.

## Done means

`pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants` pass. No `@ts-ignore`, no new
`as any`, no `.skip()`, no deleted test. State plainly that no SQL was executed and the integration
tier was not run.
