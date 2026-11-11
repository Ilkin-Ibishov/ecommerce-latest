# M3 — Counter Sale, Barcode Flow, Offline Queue, Minimal Bundles

Work order. Intent and invariants are fixed; the implementation is yours to propose.
Domain invariants: `.agents/rules/inventory.md`. Current state: `docs/STATUS.md`.
Earlier phases this one builds on: `docs/tasks/warehouse-m1-variants-ledger.md`, `-m2a-receiving-cost.md`,
`-m2b-stocktake.md`, `-m2c-reservations.md`, and their design notes in `docs/design-notes/`.
Reviewed before handover: `docs/audits/m3-spec-audit.md` (15 findings, addressed in this revision).
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

## 2. Scope and order

M3 ships in two parts on one branch, **M3a merged and usable before M3b starts** (§17):

- **M3a — online counter.** §12 security fixes; the counter sale document posting priced
  `counter_sale` movements; the scan-or-search box; the shared-barcode picker; the reservation warning;
  deposit pick-up at the till; minimal bundles; the owner's void; the plain receipt; counter and
  pick-up revenue in the margin report.
- **M3b — offline queue.** Selling while the connection is down, syncing afterwards (§9).

M3a alone solves §1. M3b carries most of the risk (audit F14) and its need is not yet measured
(§16.5); if the customer answers that drops are rare, M3b may be dropped by the architect.

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

A counter sale is a fact about the physical world: the unit left with a customer who paid. So every
check M3 adds is a **warning before** *Complete* or a **flag after** it. When an existing ledger guard
(the on-hand guard, `ST001`) refuses the stock movement, the **sale is still stored** — header and
lines, status `needs_owner`, no movements — and the owner resolves it (§6). The ledger guard holds;
the record of the sale is never lost.

This is M2c's "counter sale: warned, not blocked" generalised to every check M3 adds.

## 5. Decisions already taken — do not re-litigate; flag if you believe one is wrong

- **Counter sales are not orders.** `orders` requires a `user_id`, a delivery address and integer
  quantities, and drives the online order lifecycle. A counter sale is its own document, as M2a's
  design note already anticipated (`counter_sale_items` extension point in `get_margin_report`).
- **A posted counter sale writes one `counter_sale` movement per line**, all sharing one
  `transaction_id` (the column M1 added for exactly this), atomically, or none at all — M2a's
  receipt-posting pattern.
- **Counter sales bypass the availability check and keep the on-hand guard.** `trg_apply_stock_movement`
  already lists `counter_sale` as a bypass reason. M3 does not change the trigger.
- **Reservations are not movements.** M3 writes to `reservations` only via `fulfil_reservation`; a sale
  that eats into reserved stock changes no reservation row (M2c §4).
- **No bill of materials, no assembly.** A bundle (§10) is a shortcut for adding lines plus an
  owner-set price, as M1 decided ("boxes sold in M3 as multi-line sales with a discount rule").
- **No image recognition.** Text search instead.
- **Staff may not change prices** (M1). A staff discount is a price change; see §6 and §10.
- **The counter document is the only priced path for a till sale.** The old unpriced path closes (§12.5).

## 6. The counter sale document

**Header `counter_sales`:** `id` (uuid, generated by the client — the idempotency key), `sale_number`
(server sequence, for people), `sold_at` (device clock, as given — for the receipt), `posting_date`
(server-set, below), `payment_method` (`cash` | `card` | `other` — cannot be backfilled, so record it
now), `discount_amount` (server-computed), `discount_source` (`none` | `bundle` | `owner`), `note`,
`cashier_id` (who sold), `posted_by` (the verified session user who submitted it), `status`
(`posted` | `needs_owner` | `voided`), `needs_owner_reason`, void/resolve attribution.

**Lines `counter_sale_lines`:** variant, quantity (numeric, integer-only UI), `list_unit_price` (the
variant's `price` read by the **server**), `charged_unit_price` (what the device showed), `bundle_id`
(nullable), `net_line_total`, and server-computed flags: `price_mismatch`, `reservation_override` (§8),
`posted_after_count` (§14).

Rules:

- **One write.** There is no server-side draft; the cart lives on the device until *Complete*. One
  RPC, `post_counter_sale`, creates header, lines and movements in one transaction. Movements carry
  `reference_type = 'counter_sale'`, `reference_id = counter_sales.id::text` (a uuid, never the
  human `sale_number` — `get_margin_report` casts `reference_id::uuid`, audit F13).
- **Idempotent.** `INSERT ... ON CONFLICT (id)`: a replay with the same payload returns the existing
  sale; a replay with a different payload under the same id is rejected (it is a bug).
- **Price.** The server records `charged_unit_price` as charged and sets `price_mismatch` when it
  differs from `list_unit_price`. It does not reject (§4). The ordinary cause is an offline sale synced
  after a price change; the abnormal cause is a crafted request. The owner sees every flagged line.
- **Discount — computed by the server, never accepted from the client.**
  - Bundle: for each `bundle_id` present on the lines, discount = `max(0, list total of that bundle's
    lines still present − bundle_price)`, but only if every line of the bundle definition is present
    in at least its defined quantity; otherwise that bundle contributes no discount. The discount is
    pro-rated over **that bundle's lines only**.
  - Owner: a free `discount_amount` is accepted only when the session role is `admin`; pro-rated over
    all lines. Any discount figure from a staff session is ignored.
  - `net_line_total` is rounded so lines sum exactly to the header total.
- **Cost.** `post_counter_sale` calls `recompute_variant_cost(variant, posting_date)` once per distinct
  variant, as `post_goods_receipt` and `post_stocktake` do. Without it a sale has no
  `stock_movement_costs` row and `get_margin_report`, which **inner-joins** that table, never sees it.
  The same gap exists in `decrement_order_stock` and `fulfil_reservation` (§12.4).
- **`posting_date`.** A sale submitted live: `now()`. A sale submitted from the offline queue (M3b,
  flagged `queued = true` in the request): `sold_at` clamped to `[now() − 3 days, now()]`; outside that
  window, `now()` and a `needs_owner_reason` note (the device clock is wrong). Device clocks are never
  trusted for live sales — a slow tablet would otherwise backdate every sale.
- **`needs_owner`.** If inserting the movements raises `ST001` (on-hand would go negative with
  `allow_negative_stock` off — the shelf had a unit the system did not believe in), the transaction
  rolls back to a savepoint, the header and lines are stored with `status = 'needs_owner'` and **no
  movements**, and the call returns success with that status. The cashier sees "recorded — owner must
  check stock for X". The owner, from any device, either corrects stock (adjustment or recount) and
  calls owner-only `post_pending_counter_sale` (which posts the movements with the original
  `posting_date`), or voids it with a stored reason. Online, the scan response already carries
  `on_hand`, so the cashier is warned at scan time when a line exceeds it — before payment.
- **Void.** Owner-only `void_counter_sale(id, reason)`. For a posted sale: compensating movements with
  reason `counter_sale`, **positive** delta, `correlation_id` = the original movement, and
  **`posting_date` = the original sale's** — so the replay values the returning unit at exactly the
  cost it left at. For a `needs_owner` sale: no movements, status only. Nothing is edited or deleted.
- **Margin report signs every counter term by `quantity_delta`** (audit F3: CASE D writes a positive
  `total_cost` for both directions, and the report sums it unsigned). Units = `−delta`; revenue =
  `−delta × net unit price`; COGS = `−SIGN(delta) × total_cost`. Counter revenue joins movements to
  lines through `transaction_id` → `counter_sales` (status-aware), not through
  `reference_type`/`reference_id` alone. A sale and its void then net to zero units, revenue and cost.
- A customer returning goods days later is not a void — that stays a `customer_return` adjustment.

## 7. Barcode and text search — one box

The counter screen has **one input**. A scanner is a keyboard that types fast and presses Enter, so
the same box serves the scanner, a typed barcode and a typed name.

- On Enter: exact match on `variant_barcodes.barcode` first (the existing
  `GET /inventory/scan/:barcode` already returns a list). If no barcode matches, the text is a search.
- Search: case-insensitive substring on the product title (any language row) and variant SKU,
  staff-only, at most 20 variants, each with its option values, price, on-hand and available. At
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

**Selling reserved stock — warned, not blocked** (M2c §4). When a line's quantity exceeds the
variant's `available` (which the screen already holds from the scan), the cashier sees a warning
naming the active reservation(s) for that variant — customer name, quantity, reservation number (staff
may see these, M2c §9) — and confirms or removes the line. Inside `post_counter_sale`, after locking
the variant rows in ascending id order (the `decrement_order_stock` pattern), the server recomputes
availability and sets `reservation_override = true` on every line that took the variant's available
below zero. The flag is computed by the server, never accepted from the client, and changes no
reservation row. The owner sees the resulting deficit through M2c's `deficit_quantity`.

**Picking up a deposit.** The counter screen opens a reservation by number or phone and fulfils it
through `fulfil_reservation` (final payment included), as M2c's design note planned — once §12 has
made that function work and closed it to clients. A pick-up is its own transaction, not a line in a
counter sale (§16.7). Pick-up revenue in the margin report is the reservation's `agreed_price`, which
is the **total** for the reservation, not a unit price (M2c: `paid_amount ≤ agreed_price`, fulfilment
compares totals). Reservations cannot be partly fulfilled today, so no pro-rating is needed. The
pick-up's final payment records no payment method in M3 — M2c §6 keeps the deposit money side to two
numbers, and widening it is the customer's call (§16.4).

## 9. Offline queue (M3b) — the smallest one that is safe

Scope: **the connection drops while the counter screen is open.** Opening the app from cold with no
connection (service worker, cached app shell) is Not in M3.

- When the counter screen opens it downloads one **sellable-variant snapshot**: variant id, product
  title, option values, SKU, barcodes with `pack_quantity`, price, on-hand, available, and the bundle
  definitions. No cost, no customer data, no reservation names. Hundreds of rows; refreshed on
  reconnect. This is the only cache M3 adds, and it exists because scanning must work offline.
- *Complete* while offline puts the whole sale (client `id`, `sold_at`, `cashier_id`, lines, charged
  prices, bundle ids) into an IndexedDB queue and prints the receipt with a provisional reference (the
  first 8 characters of the id). The screen always shows how many sales are waiting.
- Sync on reconnect, **oldest first, one at a time**, through `post_counter_sale` with `queued = true`.
  Idempotency (§6) makes a resend after a lost response safe. A sale the ledger refuses becomes
  `needs_owner` **on the server** (§6), so the device queue always empties and nothing paid for is
  stranded on one device.
- **Attribution.** The queued record carries `cashier_id`; the server accepts it only if that id is a
  current `staff` or `admin` user, and always records the session user as `posted_by`. So a shift
  change during an outage needs no sign-out lock: cashier B signs in, sells under her own id, and A's
  queued sales still post as A's, submitted by B. The queue belongs to the device, not the session.
- **No reservation or availability check is possible offline.** The warning in §8 runs against the
  snapshot; the server flag is computed at sync. That is the honest limit of offline.
- **Residual risk:** clearing browser storage before sync loses those sales. Say so on the screen.

## 10. Minimal bundle

A **bundle** is a named list of (variant, quantity) plus an optional owner-set `bundle_price`. Tables
`bundles` and `bundle_lines`; owner-only write, staff read. No stock, no movement, no assembly.

At the till, adding a bundle adds its lines as ordinary lines tagged with `bundle_id`; each posts its
own `counter_sale` movement, so each component leaves stock. The cashier may add lines (untagged) — box
contents are not standardised (M1). The server computes the bundle discount (§6): if a tagged line is
removed so the bundle is incomplete, the discount disappears with it. That is deliberate: a staff
discount exists only where the owner set the price for that exact set.

Pre-assembled boxes sitting on the shelf are the case this does not model: their components stay loose
in the system until the box sells. `inventory.md` says one physical unit is counted in exactly one
place; under M3 that place is "loose", so a count must open the box or count its contents. The
customer question in §16.6 decides whether M4 needs real assembly.

## 11. The receipt

A print-friendly page (browser print, narrow-paper layout) rendered from the posted, pending or queued
sale: shop name and contact from `site_settings`, `sale_number` (or provisional reference), date and
time, cashier first name, lines, discount, total, payment method. No fiscal fields, no device
integration, no QR. Reprint from the sale list. The receipt is a view of the document, never stored
separately. If the accountant's written answer names required fields (§16.1), they are added here and
nowhere else.

## 12. Carried forward — land these first, each its own migration and commit

> **Status 2026-11-11: landed** in #7 (item 2, verified live) and #9 (items 1, 3, 4, 5, 6), applied
> to the test project and green in CI, including an end-to-end `fulfil_reservation` integration test.
> Two parts move into M3's own migrations because they name things M3 creates: `counter_sale` in
> `stock_movements_reference_type_check` (item 1), and the four new tables in `STAFF_TABLES`
> (item 3). §17 step 2 is therefore done; the design note starts from step 3.

Found while writing and auditing this spec. None was found by running SQL; `fulfil_reservation` has no
integration test. Before the migration for item 2, a human confirms read-only on the test project with
`has_function_privilege('anon', 'public.decrement_order_stock(uuid,jsonb,uuid)', 'EXECUTE')`.

1. **`fulfil_reservation` cannot succeed.** It inserts `reference_type = 'reservation'`, but the CHECK
   `stock_movements_reference_type_check` (`20261104100000`) allows only `order`,
   `goods_receipt_line`, `purchase_order`, `stocktake`, `manual`. Extend it with `reservation` and
   `counter_sale`; add an integration test that fulfils a reservation end to end.
2. **Two definer functions are callable by `anon` and every shopper.** Supabase's default privileges
   grant `EXECUTE` on new `public` functions directly to `anon` and `authenticated`, so `REVOKE ...
   FROM public` alone removes nothing. M2a/M2b revoke `FROM public, anon, authenticated`; M2c did not:
   - `decrement_order_stock` (`20261104181000`): anyone holding the public anon key can post
     `online_sale` movements for any variant and drain stock through `/rest/v1/rpc/`.
   - `fulfil_reservation` (`20261104182000`): additionally granted to `authenticated`, takes the actor
     as a parameter, checks no role — anyone can fulfil any reservation under any staff name.
   Fix both: `REVOKE EXECUTE ... FROM public, anon, authenticated; GRANT ... TO service_role`. Express
   already calls both with the service client.
3. **The invariant meant to catch item 2 inspects nothing.** `security-definer-service-role-privileges`
   (`scripts/audit/check-invariants.mjs`) matches function bodies with `(.*?)` and no `s` flag, so no
   multi-line function ever matches (0 of 13 today). Its revoke test accepts `FROM public` alone, and
   it scans only files named `20261104*`. Fix: add the `s` flag; require a revoke covering `anon` and
   `authenticated`; fail on any `GRANT EXECUTE ... TO anon|authenticated` for a definer function; scan
   every migration `>= 20261104` (also in `no-cost-column-on-staff-tables` and
   `no-expected-quantity-on-staff-endpoints`); add the four new tables to `STAFF_TABLES`; add a unit
   test that feeds the check a known-bad multi-line fixture and asserts it fires. A check that matches
   nothing looks identical to one that passes.
4. **Sales outside receipts are invisible to the margin report until the next replay.**
   `decrement_order_stock` and `fulfil_reservation` never call `recompute_variant_cost`. Add the same
   once-per-distinct-variant call to both.
5. **The unpriced till path stays open beside the new one.** `POST /admin/stock/adjust`
   (`routes/inventory.ts`) accepts `counter_sale` and `online_sale` from staff. Remove both from its
   `VALID_REASONS`. The M1 policy "Movements: staff/admin insert" on `stock_movements` has no client
   user (every write goes through Express or a definer function) and lets a staff token forge ledger
   rows through PostgREST: drop it, and add an invariant that no client role has an INSERT policy on
   `stock_movements`.
6. **Staff can mark a reservation fulfilled with no movement.** Policy "Reservations: staff update"
   lets a staff token set `status = 'fulfilled'` directly; the unit never leaves stock. Every write
   already goes through Express with the service client: drop staff UPDATE.

## 13. Roles and grants

Ask of every grant: **who actually holds this role?** `anon` is the public internet; `authenticated`
is every shopper with an account plus staff plus owner.

| | staff | owner (`admin`) | shopper / anon |
|---|---|---|---|
| Make a counter sale, scan, search, use a bundle, fulfil a deposit | yes | yes | no |
| Free discount | no (§16.3) | yes | no |
| See sales list and receipts | yes, no cost | yes | no |
| Void a sale; resolve a `needs_owner` sale | no | yes | no |
| Edit bundles | no | yes | no |
| Flagged lines (mismatch, override, posted-after-count), margin with counter revenue | no | yes | no |

- `counter_sales`, `counter_sale_lines`, `bundles`, `bundle_lines`: RLS enabled, `SELECT` policies
  that check `users.role` (never a bare `TO authenticated`), **no** insert/update/delete policy for any
  client role — all writes go through definer functions.
- `post_counter_sale`, `post_pending_counter_sale`, `void_counter_sale`: `SECURITY DEFINER`,
  `REVOKE EXECUTE ... FROM public, anon, authenticated`, `GRANT ... TO service_role` only, called by
  Express with the service client. The role check (owner-only functions, owner discount) is done by
  Express from the verified session and passed as a parameter; the existing invariant forbids
  `auth.uid()` in service-role definer bodies.
- No new view. If the design note proposes one, it is `security_invoker = true` and is not granted to
  `anon` or `authenticated` unless every column is public (`no-sensitive-columns-in-exposed-views`).
- Snapshot and search endpoints are `requireStaffOrAdmin` and return no cost field (M2a invariant).

## 14. Every rule: ordinary flow and intersections

Required by M2c §11. The design note must repeat this for every rule it adds.

| Rule | Ordinary flow | Intersects |
|---|---|---|
| One RPC posts header, lines, movements | Cashier scans 3 items, presses *Complete*; one transaction, one `transaction_id`, three movements | M2a atomic posting; M1 `transaction_id`; idempotency |
| Server reads list price, flags mismatch | Live: equal, no flag. Queued sale synced after a price change: flagged, posted | M1 "staff may not change prices" — flag, not block, because §4 |
| Discount computed by server; staff only via complete bundle | Box sold whole: discount applied. Customer keeps 1 of 3: no discount | M1 price rule; §10; audit F7 |
| Recompute cost once per variant at posting | Live sale: replay appends one row. Queued sale from 2 h ago: replay from then | M2a replay order and scope; margin report inner join; §12.4 |
| `posting_date` = `now()` live; clamped `sold_at` queued | Live: now, even on a slow device clock. Queued: real sale time within 3 days | M2a backdating; M2b snapshots (next row) |
| `posted_after_count` flag on late-arriving counter movements | Sold 14:00 offline; line counted 14:30 (snapshot still includes the unit → −1); stocktake posted 14:45; sync 15:00 (−1 again). The sale's line is flagged because a `stocktake_line` snapshot exists in `(posting_date, now()]` for that variant | M2b §4 delta posting — arithmetic unchanged; the flag is set by the late arrival, so it works whether the stocktake is draft or posted. Same rule for a void posted at the original date after a count. Owner recounts or adjusts |
| Reservation override computed server-side | Last available unit reserved, customer at till: warning, confirm, line flagged, reservation untouched, deficit shows | M2c §4 and trigger bypass list; M2c Q4 deficit display |
| On-hand guard holds; refused sale stored as `needs_owner` | System shows 0, unit in hand: scan warns; if completed, sale stored, no movement; owner fixes stock then posts | M1 non-negative ledger; M2a `allow_negative_stock`; §4 |
| Void = compensating movements at original `posting_date` | Wrong item scanned, owner voids; units, revenue, cost all net to zero | M1 append-only; M2a reversal pattern; M2a CASE D; signed margin terms (§6) |
| Bundle adds lines, no stock | Box of 3 sold: 3 movements, one discount | M1 "no BOM"; `inventory.md` composition; M2a §9 no double-count |
| Queued `cashier_id` validated, `posted_by` = session | Shift change during outage: each sale keeps its cashier | M1 "every movement records who" |
| Margin report counts counter and pick-up revenue | Day of 20 counter sales and 1 pick-up: all priced; `unpriced_units_out` only from adjustments | M2a F3 `is_priced`; §12.1, §12.4, §12.5 |

## 15. Open questions — answer in the design note, before any migration

1. Schema for the four tables, the `sale_number` sequence, and indexes (by `posting_date`, by status
   for the owner's lists).
2. `post_counter_sale`: signature, lock order, the savepoint for `needs_owner`, where each flag is
   computed, and what the idempotent replay returns.
3. Pro-rating each discount to `net_line_total` with exact rounding.
4. The margin report's revenue CTE with counter lines (via `transaction_id`) and pick-ups, signed by
   `quantity_delta`, with a guarded `reference_id::uuid` cast.
5. The effect of a void at the original `posting_date` on a margin period the owner already viewed.
6. (M3b) The snapshot's shape and size; the IndexedDB record shape and its versioning.
7. Whether the `posted_after_count` flag (§14) is enough, or something better exists.

## 16. Open questions for the customer

Engineering can start without these; each has a default that ships if no answer arrives.

1. **Accountant, in writing:** is a plain receipt enough, and must it show anything specific (tax id,
   address)? *Default: plain receipt as in §11.* Blocks go-live, not the build.
2. Is there a receipt printer, and does every customer get a paper receipt or only on request?
   *Default: print on request via the browser.*
3. May staff give a discount without the owner? Up to how much? *Default: no.*
4. Which payment methods are used; is a split payment common; should a deposit pick-up record one?
   *Default: one method per counter sale; none on pick-ups.*
5. How often does the internet drop, and must the till start with no connection at all?
   *Default: M3b survives a drop while open; cold start not supported. If drops are rare, M3b may be
   dropped.*
6. Pre-assembled boxes: how many sit on the shelf at once, and how long? *Default: few; §10 is enough.*
7. Does a deposit pick-up ever go on the same receipt as other items? *Default: separate.*
8. With a shared barcode, is "always ask which colour" acceptable at the till? *Default: yes.*
9. Should the till sell when the system shows zero on hand (`allow_negative_stock`)? *Default: off;
   such sales are stored as `needs_owner`.*
10. The shop with no barcode device: is name search enough, or do they want the system to print
    labels? *Default: search only.*
11. Do they sell anything not stocked (a service, gift wrapping)? *Default: no; see §19.*

## 17. Deliverables, in order

**M3a**

1. **Design note first** at `docs/design-notes/m3-counter-sale.md`, answering §15 and repeating §14 for
   every rule it adds. Commit it and **stop**.
2. §12 fixes, items 1–6, each its own migration (or code change) and commit, with tests.
3. Migrations for counter sales, lines, bundles; `post_counter_sale`, `post_pending_counter_sale`,
   `void_counter_sale`; margin report extension.
4. Regenerated API layer (OpenAPI → Orval → Zod). Generated files are never hand-edited.
5. API: post sale, list/get sale, void, resolve pending, search, bundles CRUD, owner's flagged list.
6. UI: the counter screen (one box, picker, reservation warning, on-hand warning, bundle button,
   deposit pick-up), receipt page, bundle editor, sale list, owner's flagged and pending lists. The
   counter screen decides whether M3 is used: build and test it at phone and desktop width with a
   keyboard-wedge scanner (simulated by typing + Enter).
7. Tests: atomic posting; idempotent replay, and rejection of a different payload under the same id;
   `on_hand = 2` with 1 reserved, two concurrent sales of 1 — both post, the second flagged
   `reservation_override`; `on_hand = 1`, two concurrent sales of 1 — one posts, the other is stored
   `needs_owner` with no movement; override computed server-side even when the client lies; client
   discount ignored, incomplete bundle gives no discount; price mismatch flagged; a sale and its void
   net to zero units, revenue and COGS in the margin report; counter and pick-up revenue priced and
   visible the same day; `anon` and a shopper token get `42501` on every definer function named in
   §12–§13 and cannot read any new table; a staff token cannot void, give a free discount, read cost,
   insert a movement, or set a reservation fulfilled; `fulfil_reservation` succeeds end to end.
8. Invariants: §12.3 and §12.5.
9. Merge M3a.

**M3b** (after M3a is merged and §16.5 is answered)

10. Snapshot endpoint, IndexedDB queue, sync loop, `queued` posting path, `posted_after_count` flag
    shown in the owner's flagged list. Tests: a queued sale backdated within the window and recomputed;
    out-of-window clock clamped and noted; resend after lost response is idempotent; a queued sale
    refused by the on-hand guard lands as `needs_owner` and the queue empties; `posted_after_count` set
    for both a draft and a posted stocktake.

## 18. Definition of done

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green, baseline empty,
  and the §12.3 fixture test proving the definer check actually fires
- `main` deployable at every commit; `docs/audits/m3-implementation-notes.md` with real output
- Every §17 item exists, or the design note says why it should not

## 19. Not in M3

Certified fiscal device or any fiscal integration. Card-terminal integration. Cash drawer, shifts,
opening float, end-of-day (Z) report. Split payments. Customer accounts, loyalty, customer debt at
the till. Returns and refunds beyond the owner's void. Coupons and a discount-rule engine. Kits with
their own stock, assembly and disassembly. Cold-start offline (service worker) and multi-device
conflict resolution beyond idempotency. Label printing. Price history. Image recognition. Locations.
Selling `track_stock = false` variants at the till: nothing reads `track_stock` today, so such a
variant sits at `on_hand = 0` and every sale of it would become `needs_owner` (unless
`allow_negative_stock` is on). Changing that is a separate decision (§16.11).

If something here genuinely cannot be built cleanly without one of them, say so in the design note.

## 20. What is not verified

The §12 defects were found by reading SQL and code, not by running them. Supabase's default function
privileges (§12.2) are how every Supabase project is provisioned; confirm on the test project before
relying on it. The integration tier is green in CI as of 2026-11-10 but contains no fulfilment test.
Write each migration as if it will be run once, in order, with no undo.
