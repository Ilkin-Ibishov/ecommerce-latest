# M3 — Counter Sale, Barcode Flow, Offline Queue, Minimal Bundles

Work order. Intent and invariants are fixed; the implementation is yours to propose.
Domain invariants: `.agents/rules/inventory.md`. Current state: `docs/STATUS.md`.
Earlier phases this one builds on: `docs/tasks/warehouse-m1-variants-ledger.md`, `-m2a-receiving-cost.md`,
`-m2b-stocktake.md`, `-m2c-reservations.md`, and their design notes in `docs/design-notes/`.
(Longer than the M2 specs because M3 has four parts and each must answer M2c §11 in writing — §14.)

## 1. Why this exists

Walk-in sales are most of this shop's sales, and the system cannot record one. Today a till sale is
either not entered at all, or entered as a stock adjustment with reason `counter_sale` and no price —
which the margin report (M2a fix F3) has to set aside as "unpriced units". So the owner's margin
figure is built from the minority of his sales, and `on_hand` drifts away from the shelf every day
between counts. M2b made the numbers true once; without the counter they stop being true by evening.

This is also the screen staff will touch fifty times a day. The competitor is still the notebook. A
sale that takes longer than writing a line in it will not be entered, and every rule below is judged
against that.

## 2. Scope

**In:** a counter sale document that posts `counter_sale` movements with prices; the scan-or-search
entry box; picking between variants that share a barcode; the reservation warning at the till;
picking up a deposit at the till; an offline queue for sales made while the connection is down; a
minimal bundle (a named list of lines with an owner-set price); a plain printable receipt; the owner's
void; counter revenue in the margin report.

**Carried forward and fixed here first** (§12) — two defects found in M2c's live SQL while writing
this spec.

## 3. Customer context

- Hundreds of SKUs, 3 staff, tens of walk-in sales a day. **Not a scale problem.** No caching beyond
  what offline operation strictly needs (§9), no denormalisation, no background jobs.
- Scanner in daily use. Colour variants of one item **share one barcode**, printed by the shop's own
  label device; that device now covers the ~10% that had none. A different shop has **no barcode
  device at all** — for them the text search is the primary path, not a fallback.
- Decided 2026-11-07: **no image recognition.** Plain text search alongside barcode entry.
- **Fiscal gate — assumption, not fact.** A plain (non-certified) receipt is enough. This was answered
  secondhand via the customer on 2026-11-07 and is **not yet in writing from the accountant**. Risk:
  if the accountant says a certified fiscal device is required, every counter sale must also pass
  through that device, and the receipt section (§11) is replaced, not extended. Build nothing that
  makes that swap harder: the receipt is a rendering of the sale document, never the record itself.
- The connection drops. How often is an open question (§16); that it happens is not.
- One shop per Supabase project (the control plane provisions one project per tenant). Tables here
  carry no `tenant_id`, exactly like `reservations`, `goods_receipts` and `stocktakes` around them.

## 4. The invariant that defines this phase

> **The till records what happened. It does not get to refuse it after the money has changed hands.**

A counter sale is a fact about the physical world: the unit left with a customer who paid. Every
check in this phase is therefore a **warning before** the sale or a **flag after** it — never a
rejection of a sale that already took place. The one exception is a sale that has not happened yet
(online, before the cashier presses *Complete*): there the existing ledger guards may still say no,
and the cashier sees why before the customer pays.

This is M2c's "counter sale: warned, not blocked" generalised to every check M3 adds.

## 5. Decisions already taken — do not re-litigate; flag if you believe one is wrong

- **Counter sales are not orders.** `orders` requires a `user_id`, a delivery address and integer
  quantities, and drives the online order lifecycle. A counter sale is its own document, as M2a's
  design note already anticipated (`counter_sale_items` extension point in `get_margin_report`).
- **A counter sale posts one `counter_sale` movement per line**, all sharing one `transaction_id`
  (the column M1 added for exactly this), atomically, or nothing at all — the receipt-posting pattern
  from M2a.
- **Counter sales bypass the availability check and keep the on-hand guard.** `trg_apply_stock_movement`
  already lists `counter_sale` as a bypass reason. M3 does not change the trigger.
- **Reservations are not movements.** Nothing in M3 writes to `reservations` except via the existing
  `fulfil_reservation`; a sale that eats into reserved stock changes no reservation row (M2c §4).
- **No bill of materials, no assembly.** "Minimal bundle" (§10) is a shortcut for adding lines plus an
  owner-set price, as M1 decided ("boxes sold in M3 as multi-line sales with a discount rule"). No
  bundle stock, no `assembly_consume`/`assembly_produce` movements.
- **No image recognition.** Text search instead.
- **Staff may not change prices** (M1). A staff discount is a price change; see §6.

## 6. The counter sale document

**Header:** client-generated `id` (uuid — the idempotency key, see §9), a human `sale_number`
assigned by the server on posting, `sold_at` (when the cashier pressed *Complete*, device clock),
`posting_date`, `payment_method` (`cash` | `card` | `other` — cannot be backfilled, so record it now),
`discount_amount` (header-level, default 0), `discount_source` (`none` | `bundle` | `owner`),
`note`, `cashier_id`, `status` (`posted` | `voided`), void attribution.

**Lines:** variant, quantity (numeric, integer-only UI), `list_unit_price` (the variant's `price`
read by the **server** at posting), `charged_unit_price` (what the device showed and charged),
`net_line_total` (after the header discount is pro-rated, rounded so lines sum exactly to the header
total), `reservation_override` (computed by the server, §8), `price_mismatch` (computed by the server:
charged ≠ list), optional `bundle_id`.

Rules:

- **Posting is the only write.** There is no server-side draft. The cart lives on the device until
  *Complete*; a half-built cart is not a business fact and has no row. One RPC creates the header,
  the lines and the movements in one transaction.
- **Price.** The server records `charged_unit_price` as charged and sets `price_mismatch` when it
  differs from the current `list_unit_price`. It does not reject: the customer has paid that amount
  (§4). The ordinary cause is an offline sale synced after the owner changed a price; the abnormal
  cause is a crafted request. The owner sees every mismatched line (§13 deliverable 5).
- **Discount.** Staff may apply a discount **only** through a bundle the owner defined (§10). A free
  discount is owner-only (`discount_source = 'owner'`). Whether staff need a capped free discount is
  an open customer question (§16).
- **Cost.** `post_counter_sale` calls `recompute_variant_cost(variant, posting_date)` once per distinct
  variant, as `post_goods_receipt` and `post_stocktake` do. Without this the sale has no row in
  `stock_movement_costs`, and `get_margin_report` (which **inner-joins** that table) does not see it
  at all. Check whether online sales (`decrement_order_stock`) have the same gap and say so in the
  design note; fixing the online path is in scope only if it is the same one-line call.
- **`posting_date`** = `LEAST(sold_at, now())`. A device clock in the future must not post into the
  future. A past `sold_at` (offline, §9) is a backdated movement and M2a's scoped replay handles it.
- **Void.** Owner-only. Posts compensating movements (reason `counter_sale`, positive delta, the
  original movement in `correlation_id`), sets the header `voided`. Nothing is edited or deleted. The
  margin report nets the pair to zero units and zero revenue. A customer coming back days later with
  a return is not a void — that stays a `customer_return` adjustment (Not in M3).

## 7. Barcode and text search — one box

The counter screen has **one input**. A scanner is a keyboard that types fast and presses Enter, so
the same box serves the scanner, a typed barcode and a typed name.

- On Enter: exact match on `variant_barcodes.barcode` first (the existing
  `GET /inventory/scan/:barcode` already returns a list). If no barcode matches, the text is a search.
- Search: case-insensitive substring on the product title (any language row) and variant SKU,
  staff-only, at most 20 variants, each with its option values, price and available quantity. At
  hundreds of SKUs a plain `ILIKE` is enough; no search index, no trigram extension.
- **One match:** the line is added (or its quantity incremented) with no further tap.
- **Several matches — the shared colour barcode.** This is the ordinary case for this shop, not an
  error. The cashier sees a picker: one large row per variant showing its option values (e.g. colour)
  first, then image, price and available quantity. Nothing is pre-selected and the system does not
  remember the last choice — guessing the colour wrong is a silent stock error on two variants. A
  variant with `available = 0` is shown, not hidden (the unit is in the customer's hand).
- **No match:** the box keeps the text, says "not found", and stays focused.
- `pack_quantity` multiplies, as in M1's adjust flow and M2a's receipt: scanning a case adds the case.

## 8. Reservations at the till

**Selling reserved stock — warned, not blocked** (M2c §4). When a line's quantity exceeds the variant's
`available` (what the screen already holds from the scan), the cashier sees a warning naming the
active reservation(s) for that variant — customer name, quantity, reservation number (staff may see
these, M2c §9) — and confirms or removes the line. Inside `post_counter_sale`, after locking the
variant rows in ascending id order (the `decrement_order_stock` pattern), the server recomputes
availability and sets `reservation_override = true` on every line that took the variant's available
below zero. The flag is the record M2c asked for. It is computed by the server, never accepted from
the client, and it changes no reservation row. The owner sees the resulting deficit through M2c's
existing `deficit_quantity`.

**Picking up a deposit.** The counter screen can open a reservation by number or phone and fulfil it
through the existing `fulfil_reservation` (final payment included), as M2c's design note planned. A
deposit pick-up is its own transaction, not a line inside a counter sale; whether customers need both
on one receipt is an open question (§16). Fulfilment movements carry `reference_type = 'reservation'`;
the margin report must price them from `reservations.agreed_price` (§12, §13).

## 9. Offline queue — the smallest one that is safe

Scope: **the connection drops while the counter screen is open.** Opening the app from cold with no
connection (service worker, cached app shell) is Not in M3 and an open customer question.

- When the counter screen opens it downloads one **sellable-variant snapshot** for the device: variant
  id, product title, option values, SKU, barcodes with `pack_quantity`, price, available. No cost, no
  customer data, no reservation names. Hundreds of rows; refreshed on reconnect. This is the only
  cache M3 adds, and it exists because scanning must work offline.
- *Complete* while offline puts the whole sale (with its client-generated `id`, `sold_at`, cashier,
  lines, charged prices) into a queue in IndexedDB and prints the receipt with a provisional reference
  (the first 8 characters of the id). The screen always shows how many sales are waiting.
- Sync on reconnect, **oldest first, one at a time**, through the same `post_counter_sale`.
  **Idempotent on `id`:** a sale already posted returns the existing record, so a sync interrupted
  after commit but before the response is safe to resend.
- **Actor.** The server records the session user as `cashier_id`, never a client-supplied id. The queue
  is per signed-in user, and **sign-out is disabled while that user's queue is non-empty** — otherwise
  a sale made by one cashier is posted under another's name or stranded.
- **A queued sale the server cannot post** (in practice `ST001`, on-hand would go negative with
  `allow_negative_stock` off — the shelf had a unit the system did not believe in) stays on the device
  marked *needs owner*, shown on the counter screen until resolved. Staff cannot discard it. The owner
  resolves it by correcting stock (a `manual_adjustment` or a recount) and retrying, or by discarding
  with a note. It is not silently dropped and not silently forced through. The residual risk —
  clearing browser storage loses unsynced sales — is written on the screen and in the design note.
- **No reservation or availability check is possible offline.** The warning in §8 runs against the
  snapshot; the server flag is computed at sync. That is the honest limit of offline.

## 10. Minimal bundle

A **bundle** is a named list of (variant, quantity) plus an optional owner-set `bundle_price`. Tables
`bundles` and `bundle_lines`; owner-only write, staff read. No stock, no movement, no assembly.

At the till, adding a bundle adds its lines as ordinary lines (each posts its own `counter_sale`
movement, so each component leaves stock) and adds `sum(list prices) − bundle_price` to the header
discount with `discount_source = 'bundle'`. The cashier may then add or remove lines — box contents
are not standardised (M1) — and the discount does **not** recompute; the owner sees the sale with its
bundle reference. If the bundle price would make the discount negative, the bundle adds no discount.

Pre-assembled boxes sitting on the shelf are the case this does not model: their components are still
loose in the system until the box sells. `inventory.md` says one physical unit is counted in exactly
one place; under M3 that place is "loose", so a count must open the box or count its contents. Say in
the design note whether that is acceptable; the customer question in §16 decides whether M4 needs
real assembly.

## 11. The receipt

A print-friendly page (browser print, narrow-paper layout) rendered from the posted sale or the
queued one: shop name and contact from `site_settings`, `sale_number` (or provisional reference),
date and time, cashier first name, lines, discount, total, payment method. No fiscal fields, no
device integration, no QR. Reprint from the sale list. The receipt is a view of the document, never
stored separately. If the accountant's written answer names required fields (§16), they are added
here and nowhere else.

## 12. Carried forward — land these first, each its own commit

Both were found in M2c's migrations while writing this spec. Neither has been executed against a real
database (`fulfil_reservation` has no integration test).

1. **`fulfil_reservation` cannot succeed.** It inserts `reference_type = 'reservation'`, but the live
   CHECK (`stock_movements_reference_type_check`, M2a migration `20261104100000`) allows only
   `order`, `goods_receipt_line`, `purchase_order`, `stocktake`, `manual`. Every real fulfilment
   would fail. M3 extends the constraint to add `reservation` and `counter_sale` (one migration, one
   concern) and adds an integration test that fulfils a reservation end to end.
2. **`fulfil_reservation` is callable by every shopper.** It is `SECURITY DEFINER`, granted to
   `authenticated`, takes the actor id as a parameter, and checks no role. In this product
   `authenticated` includes every signed-in customer (STATUS "Two failure modes", case 2), so any
   customer can fulfil any reservation through PostgREST under any staff member's name. The Express
   route already calls it with the service-role client, so revoking `authenticated` costs nothing.
   Revoke it and grant `service_role` only. The invariant `security-definer-service-role-privileges`
   did not catch this because it only requires *a* `service_role` grant — an extra `authenticated`
   grant passes — and it scans only `supabase/migrations/20261104*`. Make it fail on any `GRANT
   EXECUTE ... TO anon|authenticated` for a definer function, in every migration from 20261104 on.

## 13. Roles and grants

Ask of every grant: **who actually holds this role?** `anon` is the public internet; `authenticated`
is every shopper with an account plus staff plus owner.

| | staff | owner (`admin`) | shopper |
|---|---|---|---|
| Make a counter sale, scan, search, use a bundle | yes | yes | no |
| Free discount | no (§16) | yes | no |
| See sales list and receipts | yes, no cost | yes | no |
| Void a sale | no | yes | no |
| Edit bundles | no | yes | no |
| See price-mismatch, override, needs-owner lists; margin with counter revenue | no | yes | no |

- `counter_sales`, `counter_sale_lines`, `bundles`, `bundle_lines`: RLS enabled, `SELECT` policies
  that check `users.role` (never bare `TO authenticated`), **no** insert/update/delete policies for
  any client role — all writes go through definer functions.
- `post_counter_sale` and `void_counter_sale`: `SECURITY DEFINER`, `REVOKE ... FROM public`,
  `GRANT` to `service_role` only, called by Express with the service client; the actor comes from the
  verified session, never the body.
- No new view. If the design note proposes one, it is `security_invoker = true` and is not granted to
  `anon` or `authenticated` unless every column is public (invariant
  `no-sensitive-columns-in-exposed-views`).
- The snapshot and search endpoints are `requireStaffOrAdmin` and return no cost field (M2a invariant).

## 14. Every rule: ordinary flow and intersections

Required by M2c §11. The design note must repeat this for every rule it adds.

| Rule | Ordinary flow | Intersects |
|---|---|---|
| One RPC posts header, lines, movements | Cashier scans 3 items, presses *Complete*; one transaction, one `transaction_id`, three movements | M2a atomic posting; M1 `transaction_id`; idempotency on `id` (§9) |
| Server reads list price, records charged price, flags mismatch | Online: equal, no flag. Offline sale synced after a price change: flagged, posted | M1 "staff may not change prices" — a flag, not a block, because §4 |
| Staff discount only via bundle | Box sold: bundle adds discount; staff never type a number | M1 price rule; §10 |
| Recompute cost once per variant at posting | Sale at `now()`: replay appends one row. Offline sale from 2 h ago: replay from then | M2a replay order and scope; margin report inner join |
| `posting_date = LEAST(sold_at, now())` | Online: ≈ now. Offline: the real sale time | M2a backdating; **M2b snapshot** (next row) |
| Offline sale synced after a count line was entered | Sold 14:00 offline, line counted 14:30 (unit gone, snapshot still includes it → correction −1), synced 15:00 (−1 again): the loss is counted twice | M2b §4 delta posting. Required: the variance review flags any line whose variant has a `counter_sale` movement with `posting_date` ≤ line snapshot time and `created_at` > it; the owner recounts that line. M2b's arithmetic is not changed. Propose a better fix in the design note if you see one |
| Reservation override computed server-side | Last unit reserved, customer at till: warning, confirm, line flagged, reservation untouched, deficit shows | M2c §4 and trigger bypass list; M2c Q4 deficit display |
| Counter sale keeps the on-hand guard | Online with stock: passes. On-hand 0 but unit in hand: cashier sees `ST001` before payment | M2a `allow_negative_stock`; offline *needs owner* path (§9) |
| Void = compensating movements, owner-only | Wrong item scanned, owner voids; stock and revenue net to zero | M1 append-only ledger; M2a reversal-document pattern; M2a replay (void posts at original `posting_date`? decide and justify) |
| Bundle adds lines + discount, no stock | Box of 3 sold: 3 movements, one discount | M1 "no BOM"; `inventory.md` composition rules; M2a §9 no double-count |
| Sign-out blocked while queue non-empty | Cashier ends shift online: queue empty, sign-out works | Actor attribution (M1 "every movement records who") |
| Margin report counts counter and deposit revenue | Day of 20 counter sales: all priced, `unpriced_units_out` falls to manual adjustments only | M2a F3 `is_priced` logic; §12 item 1 |

## 15. Open questions — answer in the design note, before any migration

1. Schema for the four tables, the `reference_type` values, and the `sale_number` sequence.
2. `post_counter_sale`: signature, lock order, where the override and mismatch flags are computed,
   the idempotency mechanism (`INSERT ... ON CONFLICT (id)` and what is returned on replay), and what
   a replay with a **different** payload under the same id does (expected: reject, it is a bug).
3. Pro-rating the header discount to `net_line_total` with exact rounding.
4. How the margin report's revenue CTE gains counter lines and reservation pick-ups without
   double-counting a voided sale.
5. The void's `posting_date`, and its effect on a margin period already viewed.
6. The offline snapshot's shape and size, and the IndexedDB queue's record shape and versioning.
7. Whether the online sale path has the missing-recompute gap (§6), with evidence.
8. Whether the M2b late-sync flag (§14) is enough, or the variance should subtract late movements.

## 16. Open questions for the customer

Engineering can start without these; each has a default that ships if no answer arrives.

1. **Accountant, in writing:** is a plain receipt enough, and must it show anything specific (tax id,
   address)? *Default: plain receipt as in §11.* Blocks go-live, not the build.
2. Is there a receipt printer, and does every customer get a paper receipt or only on request?
   *Default: print on request via the browser.*
3. May staff give a discount without the owner? Up to how much? *Default: no.*
4. Which payment methods are used, and is a split payment (part cash, part card) common?
   *Default: one method per sale.*
5. How often does the internet drop, and must the till start with no connection at all?
   *Default: survives a drop while open; cold start not supported.*
6. Pre-assembled boxes: how many sit on the shelf at once, and how long? *Default: few; §10 is enough.*
7. Does a deposit pick-up ever go on the same receipt as other items? *Default: separate.*
8. With a shared barcode, is "always ask which colour" acceptable at the till? *Default: yes.*
9. Should the till sell when the system shows zero on hand (`allow_negative_stock`)? *Default: off;
   the owner corrects stock.*
10. The shop with no barcode device: is name search enough, or do they want the system to print
    labels? *Default: search only; label printing is Not in M3.*

## 17. Deliverables, in order

1. **Design note first** at `docs/design-notes/m3-counter-sale.md`, answering §15 and repeating §14
   for every rule it adds. Commit it and **stop**.
2. §12 fixes, each its own migration and commit, with tests.
3. Migrations for counter sales, lines, bundles; `post_counter_sale`, `void_counter_sale`; margin
   report extension.
4. Regenerated API layer (OpenAPI → Orval → Zod). Generated files are never hand-edited.
5. API: post sale, list/get sale, void, search, snapshot, bundles CRUD, owner's flagged-lines list
   (mismatch, override, voided).
6. UI: the counter screen (one box, picker, reservation warning, bundle button, deposit pick-up,
   queue indicator, *needs owner* list), receipt page, bundle editor, sale list. The counter screen is
   the deliverable that decides whether M3 is used; build and test it on a phone-width and a
   desktop-width screen with a keyboard-wedge scanner (simulated by typing + Enter).
7. Tests: atomic posting; idempotent replay; two cashiers selling the last unit concurrently (both
   post, override flagged, on-hand guard holds); override computed server-side even when the client
   lies; price mismatch flagged; void nets to zero in the margin report; counter revenue priced;
   offline sale backdated correctly and recomputed; staff token cannot void, cannot free-discount,
   cannot read cost; a shopper token cannot call any new function or read any new table;
   `fulfil_reservation` succeeds end to end.
8. Invariants: the §12 extension of `security-definer-service-role-privileges`; counter-sale and
   bundle tables have no client write policy.

## 18. Definition of done

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green, baseline empty
- `main` deployable at every commit; `docs/audits/m3-implementation-notes.md` with real output
- Every §17 item exists, or the design note says why it should not

## 19. Not in M3

Certified fiscal device or any fiscal integration. Card-terminal integration. Cash drawer, shifts,
opening float, end-of-day (Z) report. Split payments. Customer accounts, loyalty, customer debt at
the till. Returns and refunds beyond the owner's void. Coupons and a discount-rule engine. Kits with
their own stock, assembly and disassembly. Cold-start offline (service worker) and multi-device
conflict resolution beyond idempotency. Label printing. Price history. Image recognition. Locations.
Changing `track_stock` semantics (counter lines post movements as online sales do today).

If something here genuinely cannot be built cleanly without one of them, say so in the design note.

## 20. What is not verified

The two §12 defects were found by reading SQL, not by running it. The integration tier is green in
CI as of 2026-11-10 but contains no fulfilment test. Every migration in this phase is checked by CI
against the test project; write each one as if it will be run once, in order, with no undo.
