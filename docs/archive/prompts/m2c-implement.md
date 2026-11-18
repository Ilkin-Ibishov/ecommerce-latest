# M2c — implement

The design note is **approved**. The concurrency argument in §2.3 is correct — `SELECT … FOR UPDATE`
under READ COMMITTED does re-read the latest committed row version once the lock is granted, so the
second transaction genuinely sees the decremented on-hand. That is the right enforcement point and
the right proof.

Your four disagreements are accepted, and the first is a defect in my work order:

- **§8.1** — I wrote "editable by the owner only" in §6 and "staff … record a payment" in §9. Those
  contradict. Your split is correct: staff may increment `paid_amount` up to `agreed_price`, never
  change `agreed_price`, never release.
- **§8.2** — `release_reason` recording whether cash was refunded or forfeited is the right thin
  answer. Adopted.
- **§8.3** — sorting variant ids before locking to avoid deadlocks is correct. See **C1**, which
  escalates what you found.
- **§8.4** — the single join through the availability view instead of per-product queries. Adopted.

**These instructions are prescriptive. Implement them as written. Do not substitute another design,
do not refactor what they do not touch.** If you think one is wrong, implement it and say so in your
notes.

Order: C1 … C6, then the rest of the work order's §12 deliverables. One commit per numbered item.

---

## C1 — the multi-item order loop is now a real failure path, not a theoretical one  [must, do this first]

Your §8.3 noticed that `artifacts/api-server/src/routes/orders.ts` decrements stock for a multi-item
order in a JavaScript loop calling `decrementStockSafe` per line, with best-effort rollback. Sorting
the ids prevents deadlocks, but it does not fix the real problem, and M2c makes that problem common:

before this phase the only way a line could fail mid-loop was insufficient on-hand, which the
storefront had already filtered. Now `ST014` adds a second, much more likely failure — a unit that is
physically present but reserved. So the normal outcome becomes: line 1 decrements, line 2 raises
`ST014`, and the JS rollback is the only thing standing between the shop and an order that took stock
for goods it never sold.

Fix it properly: one database call per order, not one per line.

- Add `decrement_order_stock(p_order_id uuid, p_lines jsonb, p_actor_id uuid)` that locks each
  variant `FOR UPDATE` in **ascending variant_id order**, checks availability for every line, then
  inserts every movement — all in one transaction. Any line failing aborts the whole thing and writes
  nothing.
- `orders.ts` calls it once. Keep `decrementStockSafe` exported and working for any other caller;
  do not delete it.
- Test: a two-line order where the second line is fully reserved must leave **zero** movements and
  the first line's on-hand unchanged.

## C2 — fulfilment must not require the balance to be paid first  [must]

Your state machine requires `paid_amount == agreed_price` before `active → fulfilled`. The most
common counter event is the customer paying the remainder **at pickup**: staff would have to record a
payment and then fulfil, two actions, and if they forget the first the goods cannot be released at
all.

Fix: `fulfil_reservation(p_reservation_id, p_actor_id, p_final_payment numeric DEFAULT 0)` applies the
final payment and the fulfilment in one transaction. After applying it, `paid_amount` must equal
`agreed_price`, otherwise raise `ST015` naming the shortfall. The deposit screen does pay-and-collect
as one button.

Test: a reservation with 20 paid of 50 fulfilled with `p_final_payment = 30` succeeds and ends
`fulfilled` with `paid_amount = 50`; with `p_final_payment = 10` it raises `ST015` and changes
nothing.

## C3 — "active but expired" must not be two different truths  [must]

Your Q3 leaves an expired reservation with `status = 'active'` while availability excludes it. So the
same row is active to one reader and expired to another, and the aged list, the deposit screen and
the storefront will each decide for themselves. That is the divergence class that produced three M2b
defects.

Fix: compute the effective state **once**, in the database, and have every reader use it.

- Add `effective_status` to the availability view's sibling — a column computed as: `released` and
  `fulfilled` pass through; `active` with `expires_at` in the past becomes `expired`; otherwise
  `active`.
- Every API response about a reservation returns `effective_status`, never the raw `status` alone.
- The aged list and the deposit screen read `effective_status`.
- Keep the stored `status` column as the record of what was *done* to the reservation. Nothing writes
  `expired` to it automatically.

Test: a reservation with `status = 'active'` and `expires_at` one hour in the past reports
`effective_status = 'expired'`, is excluded from `reserved_quantity`, and still appears in the aged
list.

## C4 — one place computes availability, and it exposes the deficit too  [must]

The storefront needs `GREATEST(0, H − R)`. The admin needs to see that `H` is **below** `R`, which
the clamped number destroys. Your note has the admin screen showing `Available: −2 (Deficit 2)` while
the view only exposes the clamped value — so the admin would recompute it somewhere else, and the two
will drift.

Fix: `product_variant_availability` exposes three numbers, and nobody recomputes any of them:

- `reserved_quantity` — the sum of effectively-active reservations
- `available_quantity` — `GREATEST(0, on_hand − reserved_quantity)`, what a customer may be shown
- `deficit_quantity` — `GREATEST(0, reserved_quantity − on_hand)`, how far promises exceed stock

The admin inventory screen reads all three. The storefront reads `available_quantity` only.

## C5 — the public grant leaks reserved quantities  [must]

`GRANT SELECT ON public.product_variant_availability TO anon` exposes `reserved_quantity` to anyone
browsing the shop. A view is not `security_invoker` by default, so it runs with its owner's rights and
RLS on `reservations` does not apply — you correctly kept customer names out, but how much is promised
is still the shop's business, and M2a established that business figures do not reach a role that does
not need them.

Fix: two objects, one source.

- `product_variant_availability` — full, with all three numbers. Granted to `authenticated` and
  `service_role` only, and readable in practice only by staff and owner paths.
- `product_variant_public_availability` — selects `variant_id`, `product_id`, `available_quantity`
  from the first view and nothing else. This is the one granted to `anon`.
- Revoke `anon` from the full view. The storefront reads the public one.
- Add an executable invariant: no view or table granted to `anon` may expose a column matching
  `/reserved|deficit|cost|margin/i`. Extend the existing `no-cost-column-on-staff-tables` check or add
  a sibling; say which you did and why.

Test: an anonymous PostgREST read of the public view returns `available_quantity` and no
`reserved_quantity`; an anonymous read of the full view is refused.

## C6 — state which reasons deliberately bypass the availability check  [must]

Your trigger checks availability only when `NEW.reason = 'online_sale'`. That is the right scope, but
it is currently implicit, and the next phase will not know whether the omissions were decisions or
oversights.

Fix: a comment block above the check naming every reason that bypasses it and why, in one line each —
`counter_sale` (the customer is at the till and the unit is physically present; M3 records the
override), `stocktake_correction` and `opening_balance` (physical observation outranks a promise),
`damage_write_off` and `return_to_supplier` (the unit is gone), `manual_adjustment` (owner's explicit
correction), `customer_return` and `goods_receipt` (inbound). Add the same list to
`.agents/rules/inventory.md` as three lines, not thirty.

And make the fulfilment ordering explicit and tested: `fulfil_reservation` must set the reservation
out of its effectively-active state **before** inserting the `counter_sale` movement, so that a
reservation can never be counted against the sale that fulfils it. Test that fulfilling the last
reserved unit succeeds.

---

## The rest of the phase

Everything else in §12 of the work order stands as written: the migrations, the regenerated API
layer, the five routes plus the aged list, the storefront and admin UI per §8, the seven tests in
§12.6, and the invariant in §12.7.

Two reminders from §8 of the work order, because this is the diff that touches the public shop:

- Your call-site list in §6 is the starting point, not the complete one. Treat the "needs
  verification" entries as work, not as notes.
- `StockCell` adjusts physical on-hand, never reservations. Make that unambiguous in the UI.

## Definition of done

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green, baseline empty
- Every test named in C1 … C6 present and passing, plus §12.6's seven
- `main` deployable at every commit
- `docs/audits/m2c-implementation-notes.md` written: what changed per item, anything you believe is
  wrong in these instructions, which test tiers you actually ran, and the real output of the three
  commands

Do not run migrations against any remote Supabase project. Regenerate the API layer through codegen if
`openapi.yaml` changes; never hand-edit generated files.
