# M3a Design Note: Counter Sale, Scan-or-Search, Bundles, Void

Spec: `docs/tasks/warehouse-m3-counter-sale.md`. Audit of the spec: `docs/audits/m3-spec-audit.md`.
Scope: **M3a only** (spec §2). M3b (offline queue) gets its own addendum to this note before it starts,
once §16.5 is answered; §15 Q6 is deferred there.
§12 is already done (#7, #9), so implementation starts at spec §17 step 3.

This note is about 300 lines. It answers seven open questions, repeats spec §14 for every rule it
adds, and lists every deviation from the spec. The earlier M2 notes were 365 to 1199 lines.

## 1. The shape in one paragraph

The device keeps the cart. *Complete* sends one request. Express validates the session and the
payload, then calls one definer function, `post_counter_sale`, with the service client. That function
writes the header, the lines and one `counter_sale` movement per line in a single transaction.
The movements' `transaction_id` is the sale's own `id`. If the on-hand guard refuses the movements,
the sale is stored as `needs_owner` with no movements. The owner then either posts it or voids it.
A void writes compensating movements at the original `posting_date`. The margin report finds counter
revenue through `transaction_id` and signs every term by `quantity_delta`.

## 2. Answers to spec §15

### Q1. Schema

New migrations, one concern each, all forward-only:

1. `…_m3_reference_type_counter_sale.sql`: adds `counter_sale` to
   `stock_movements_reference_type_check` (the part of §12 item 1 that was left for M3).
2. `…_m3_bundles.sql`
3. `…_m3_counter_sales.sql`
4. `…_m3_counter_functions.sql`
5. `…_m3_margin_report_counter_revenue.sql`

```sql
CREATE SEQUENCE public.counter_sale_number_seq;

CREATE TABLE public.bundles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(trim(name)) > 0),
  bundle_price  numeric(10,2) CHECK (bundle_price >= 0),      -- NULL = no discount, just a shortcut
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid NOT NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.bundle_lines (
  bundle_id   uuid NOT NULL REFERENCES public.bundles(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity    numeric(12,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (bundle_id, variant_id)
);

CREATE TABLE public.counter_sales (
  id                  uuid PRIMARY KEY,                      -- client-generated idempotency key
  sale_number         bigint NOT NULL UNIQUE DEFAULT nextval('public.counter_sale_number_seq'),
  payload_hash        text NOT NULL,                         -- md5 of the normalised jsonb request
  sold_at             timestamptz NOT NULL,                  -- device clock, receipt only
  posting_date        timestamptz NOT NULL,                  -- server-set (Q2)
  payment_method      text NOT NULL CHECK (payment_method IN ('cash', 'card', 'other')),
  bundle_discount     numeric(12,2) NOT NULL DEFAULT 0 CHECK (bundle_discount >= 0),
  owner_discount      numeric(12,2) NOT NULL DEFAULT 0 CHECK (owner_discount >= 0),
  total_amount        numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  note                text,
  cashier_id          uuid NOT NULL REFERENCES public.users(id),
  posted_by           uuid NOT NULL REFERENCES public.users(id),
  status              text NOT NULL CHECK (status IN ('posted', 'needs_owner', 'voided')),
  needs_owner_reason  text,
  resolved_by uuid REFERENCES public.users(id), resolved_at timestamptz,
  voided_by   uuid REFERENCES public.users(id), voided_at   timestamptz, void_reason text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_void_attribution CHECK (status <> 'voided' OR (voided_by IS NOT NULL AND voided_at IS NOT NULL
                                         AND char_length(trim(void_reason)) > 0)),
  CONSTRAINT chk_needs_owner_reason CHECK (status <> 'needs_owner' OR needs_owner_reason IS NOT NULL)
);
CREATE INDEX idx_counter_sales_posting_date ON public.counter_sales (posting_date DESC);
CREATE INDEX idx_counter_sales_open ON public.counter_sales (created_at) WHERE status = 'needs_owner';

CREATE TABLE public.counter_sale_lines (
  sale_id              uuid NOT NULL REFERENCES public.counter_sales(id) ON DELETE RESTRICT,
  line_no              integer NOT NULL CHECK (line_no > 0),
  variant_id           uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity             numeric(12,3) NOT NULL CHECK (quantity > 0),
  list_unit_price      numeric(10,2) NOT NULL,      -- product_variants.price, read by the server
  charged_unit_price   numeric(10,2) NOT NULL,      -- what the device showed
  bundle_id            uuid REFERENCES public.bundles(id) ON DELETE RESTRICT,
  net_line_total       numeric(12,2) NOT NULL,
  price_mismatch       boolean NOT NULL DEFAULT false,
  reservation_override boolean NOT NULL DEFAULT false,
  posted_after_count   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (sale_id, line_no)
);
CREATE INDEX idx_counter_sale_lines_variant ON public.counter_sale_lines (variant_id);
```

**RLS.** RLS is enabled on all four tables. Each table gets one policy, `SELECT` for
`public.is_admin()`. There is no staff policy and no write policy for any client role. Staff never
read these tables through PostgREST: the counter screen, the sale list and the receipt all go through
Express, which shapes the response and drops the owner-only flags. This is stricter than spec §13,
which gave staff `SELECT`. Rows cannot hide columns, so a staff `SELECT` would expose
`price_mismatch` and `reservation_override`, which §13 says staff must not see. The four tables are
added to `STAFF_TABLES` (§12 item 3) anyway, so a cost column can never appear on them.
There are no `tenant_id` columns: one shop per project (spec §3).

### Q2. `post_counter_sale`

```
post_counter_sale(p_payload jsonb, p_session_user uuid, p_session_role text, p_queued boolean DEFAULT false)
  RETURNS jsonb   -- { id, sale_number, status, needs_owner_reason, replayed, lines: [{ line_no, flags }] }
SECURITY DEFINER; REVOKE FROM public, anon, authenticated; GRANT TO service_role
```

Express validates the payload with Zod first. Allowed fields: `id`, `sold_at`, `payment_method`,
`note`, `owner_discount`, `cashier_id`, and `lines[{variant_id, quantity, charged_unit_price,
bundle_id}]` with at most 200 lines. Express also passes the session user and role from
`requireStaffOrAdmin`. The function body has no `auth.uid()`, as the invariant requires.

Order inside the one transaction:

1. **Idempotency.** `INSERT INTO counter_sales (id, payload_hash, …) … ON CONFLICT (id) DO NOTHING`
   comes first. On conflict, the function compares `payload_hash`:
   - equal: it returns the stored sale with `replayed = true`;
   - different: it raises `ST020` (a bug, not a retry).

   A concurrent identical replay blocks on the unique index until the first commits, then sees the
   row. `payload_hash = md5(p_payload::text)`; the text form of `jsonb` is normalised, so key order
   does not matter.
2. **Cashier.**
   - Live sale: `cashier_id` must equal `p_session_user`, otherwise `ST021`. The spec left this open.
     Live, the person at the till is the session.
   - Queued sale (M3b): any current `staff`/`admin` user is accepted.
   - Either way, `posted_by = p_session_user`.
3. **Lock** every distinct variant in the payload `FOR UPDATE ORDER BY id`. This is the same order as
   `decrement_order_stock`, so the two cannot deadlock. The lock also makes the reads that follow
   exact. Reservation creation takes no lock today (§6, finding 8).
4. **Read** `price` and `on_hand`, and the active reservations per variant, using M2c's
   `effective_status` predicate.
5. **Discounts** (Q3).
6. **Flags.** All computed here; nothing from the client is trusted.
   - `price_mismatch = charged_unit_price <> list_unit_price`.
   - `reservation_override` is set on every line of a variant where
     `on_hand − reserved − Σ quantity of that variant in this sale < 0`, and `reserved > 0`. Without
     a reservation, a shortfall is an on-hand problem (step 8), not an override.
   - `posted_after_count` (Q7) can only be true for queued sales and for voids.
7. **`posting_date`.**
   - Live: `now()`.
   - Queued: `sold_at`, clamped to `[now() − 3 days, now()]`. Out of range means `now()` plus a
     `needs_owner_reason` note, but status stays `posted` if the movements post.
8. **Movements.** Inside a `BEGIN … EXCEPTION WHEN SQLSTATE 'ST001' … END` block, which is
   PL/pgSQL's savepoint, the function inserts one movement per line:
   `reason 'counter_sale'`, `reference_type 'counter_sale'`, `reference_id = id::text`,
   `transaction_id = id`, `posting_date`, and `actor_id = cashier_id`. It then calls
   `recompute_variant_cost(variant, posting_date)` once per distinct variant.
   - On `ST001`, the block rolls back to the savepoint. The header becomes `needs_owner` with reason
     `on_hand` and the lines stay. The call still succeeds.
   - Why the exception instead of a pre-check: the trigger stays the only place that decides
     "negative", so `allow_negative_stock` keeps working unchanged.
9. **Return** the sale and its per-line flags. The screen shows "recorded, owner must check stock"
   for `needs_owner`.

`post_pending_counter_sale(id, p_session_user)` is owner-only and is checked in Express. It runs step
8 for a `needs_owner` sale at the sale's stored `posting_date`. If the stock is still short it raises
`ST001` to the owner, who can see why. On success it sets `resolved_by` and `resolved_at`.

`void_counter_sale(id, reason, p_session_user)` is owner-only.
- For a `posted` sale it inserts one movement per line: `+quantity`, `reason 'counter_sale'`, the
  same `reference_id` and `transaction_id`, `correlation_id` = the original movement, at the
  **original** `posting_date`. It then recomputes from that date.
- For a `needs_owner` sale it changes the status only.
- Voiding a `voided` sale raises `ST022`.

### Q3. Pro-rating with exact rounding

All amounts are worked in qəpik (integer). Base for line *i*: `gross_i = charged_unit_price_i ×
quantity_i`. The base is **charged**, not list price: revenue is the money taken. A mismatch is
flagged separately, so nothing is hidden.

- **Bundle discount.** Spec §6 gives the bundle a discount only if every line of the bundle
  definition is present in at least its defined quantity. That breaks for two boxes sold together.
  Instead, per `bundle_id`, `k = min over bundle_lines ⌊tagged qty / defined qty⌋`, and
  `discount = k × max(0, Σ defined qty × charged price − bundle_price)`. `k = 0` means no discount.
  This matches the spec for one box and is correct for *n* boxes.
- **Owner discount.** Accepted only when `p_session_role = 'admin'`. It is capped at the total after
  bundle discounts. From a staff session it is ignored and replaced by 0, not rejected (spec §6).
- **Allocation (largest remainder).**
  1. `share_i = ⌊D × gross_i / Σgross⌋`.
  2. Hand the remaining `D − Σshare` qəpik, one each, to the lines with the largest fractional
     parts, ties by `line_no`.
  3. `net_line_total_i = gross_i − share_i`.

  The lines then sum exactly to `total_amount`. A bundle discount spreads over that bundle's tagged
  lines; the owner discount spreads over all lines after that. Unit test: random lines and
  discounts, assert `Σnet = total` and every `net ≥ 0`.

### Q4. Margin report

`get_margin_report` gets a new body. The signature and grants stay the same. The changes are in
`movement_sales` and `movement_revenue`:

- `movement_sales` also selects `sm.transaction_id`.
- **Unit price per movement:**
  - **Counter sale:** `counter_line_prices` = `Σ net_line_total / Σ quantity` per
    `(sale_id, variant_id)` over sales in status `posted` or `voided`, joined on
    `ms.reference_type = 'counter_sale' AND clp.sale_id = ms.transaction_id`. The join is uuid to
    uuid, so there is no cast. It is a per-variant weighted price, like orders, because a variant
    can sit on two lines (once in a bundle, once loose).
  - **Deposit pick-up:** `ms.reference_type = 'reservation'`. The price is
    `r.agreed_price / r.quantity`, joined on
    `r.id = CASE WHEN ms.reference_type = 'reservation' THEN ms.reference_id::uuid END`.
  - **Orders:** the existing order join gets the same `CASE` guard on its `reference_id::uuid`
    (audit F13). Today it relies on join order.
- **Signs for counter and reservation terms:**
  - `units = −delta`;
  - `revenue = −delta × unit_price`;
  - `cogs = −SIGN(delta) × total_cost`.

  A sale and its void net to zero on all three. Order and return terms stay as they are, so online
  figures do not move.
- `is_priced` becomes true for counter and reservation terms when a price row joined.
  `unpriced_units_out` then only counts old adjustment-based sales from before §12 item 5.

Test: one sale, one void, one pick-up in a day. Report shows counter units 0, pick-up revenue equals
`agreed_price`, and online rows are unchanged against a fixture taken before the migration.

### Q5. A void in a period the owner already viewed

The void posts at the sale's original `posting_date`, so that day's figures change after the fact:
the sale disappears from them. This is the correct accounting, because the sale never happened.
Nothing is stored or closed per period today, so nothing goes stale. The owner's void list shows
`voided_at` beside the original date, so a changed figure can be explained.

The other choice is to void at `now()`. The old period would then keep a sale that did not happen,
and the current period would show a negative sale. That is worse. If period closing is ever added,
a void into a closed period becomes a new decision.

### Q6. Snapshot and IndexedDB (M3b)

Deferred to the M3b addendum (spec §2: M3b starts only after M3a is merged).

### Q7. Is `posted_after_count` enough?

Yes, and it only needs one query. A line is flagged when
`EXISTS (stocktake_line_snapshots s JOIN stocktake_lines l ON l.id = s.line_id
WHERE l.variant_id = line.variant_id AND s.captured_at > sale.posting_date)`.

- In M3a this can only fire on voids. A live sale's `posting_date` is `now()`, so no later snapshot
  exists.
- Voids write the flag onto the original lines, which are then re-read. This is the one update
  `void_counter_sale` makes to a line.

A better option exists only with locations or per-count cut-off times, which are out of scope.

## 3. API and screens

New endpoints are added to `lib/api-spec/openapi.yaml`, regenerated with Orval, and validated by the
generated Zod schemas.

| Endpoint | Role | Notes |
|---|---|---|
| `GET /admin/counter/lookup?q=` | staff | Barcode exact match first (reuses the scan query), else `ILIKE` on translation titles and SKU, max 20. Returns option values, price, on_hand, available, and active reservation names for variants with `available ≤ 0`. No cost. |
| `POST /admin/counter/sales` | staff | Body as Q2. `201` new, `200` replay. |
| `GET /admin/counter/sales`, `GET /admin/counter/sales/:id` | staff / admin | Staff: no flags. Admin: flags. Receipt reads `GET :id`. |
| `POST /admin/counter/sales/:id/void` | admin | `{ reason }` |
| `POST /admin/counter/sales/:id/post-pending` | admin | |
| `GET /admin/counter/flagged` | admin | Lines with any flag, plus `needs_owner` sales. |
| `GET/POST/PUT/DELETE /admin/bundles` | staff read, admin write | Delete means `is_active = false` once a sale references the bundle. |

Deposit pick-up reuses the existing `POST /admin/reservations/:id/fulfil`. The counter screen only
adds a "pick up deposit" panel that searches reservations by number or phone.

`requireStaffOrAdmin` is defined twice today (`inventory.ts`, `admin/reservations.ts`). The counter
routes will import one shared copy moved to `middlewares/`. The existing two then use it too. That is
a small refactor inside this phase, not a new abstraction.

Screens:
- `CounterPage`: split into `LookupBox`, `VariantPicker`, `CartLines`, `ReservationWarning`,
  `PickupPanel`, each under 200 lines.
- `CounterSalesPage`: list plus owner tabs for flagged and pending sales.
- `CounterReceiptPage`: print CSS, narrow paper.
- `BundlesPage`.

The lookup box keeps focus after every action, so a keyboard-wedge scanner works without a tap.

## 4. Spec §14 repeated for every rule this note adds

| Rule | Ordinary flow | Intersects |
|---|---|---|
| `transaction_id = counter_sales.id` | Three scans, *Complete*: three movements sharing the sale id | M1 `transaction_id`; Q4 join; void reuses it so sale and void group together |
| Idempotency by `id` and `payload_hash`; `ST020` on a different payload | Lost response, device resends: same sale returned, `replayed = true` | Spec §6; M3b resend |
| Live `cashier_id` must equal the session user | Cashier signed in, sells: equal, no friction | M1 "every movement records who"; M3b relaxes it for queued sales only |
| One lock pass, ascending variant id, before any read | Two tills sell the last reserved unit at once: second waits, then sees the first, then flags override | `decrement_order_stock` lock order; reservation creation does not lock (§6.8) |
| Override only when `reserved > 0` | Variant with no reservations and stock 0: no override, the on-hand guard decides | Spec §8; the `needs_owner` rule |
| `needs_owner` via the trigger's `ST001` in a savepoint | System shows 0, unit in hand: sale stored, no movement, owner notified | M1 guard unchanged; `allow_negative_stock` honoured by the trigger alone |
| Discount base is the charged price | Live: charged = list, no difference. Mismatch: revenue is what was taken, line flagged | M1 staff may not change prices; spec §6 |
| Bundle discount × *k* complete sets | Two boxes: double discount. One item removed from one box: one discount | Spec §10; M1 "no BOM" |
| Owner discount from a staff session ignored | Staff sends 5 AZN: posted at 0 discount | M1 price rule; audit F7 |
| Staff read counter tables only through Express | Staff list shows sales without flags | Spec §13 (stricter); `no-sensitive-columns-in-exposed-views` |
| Void at the original `posting_date`, flag `posted_after_count` | Owner voids yesterday's wrong scan: units, revenue and COGS net to 0 for yesterday | M2a replay order; M2b delta posting; Q5 |
| Guarded `reference_id::uuid` casts in the margin report | A `manual` movement with a non-uuid `reference_id` no longer risks a cast error | Audit F13; M2a margin report |

## 5. Tests

These map one to one to spec §17 item 7.
- **Unit:** discount allocation (property test).
- **Integration (live ledger):**
  - atomic posting;
  - idempotent replay and `ST020`;
  - the two concurrency cases (`on_hand 2` / 1 reserved; `on_hand 1`), run as two parallel RPC calls;
  - override computed server-side with a lying client;
  - staff discount ignored; incomplete bundle gives no discount;
  - mismatch flag;
  - sale plus void nets to zero in the margin report;
  - pick-up revenue the same day;
  - `42501` for `anon` and a shopper on every new definer function;
  - no `SELECT` on the four tables for staff or shopper tokens;
  - staff `403` on void, post-pending and owner discount.
- **E2E:** scan, picker, *Complete*, receipt, at phone and desktop width.

## 6. Where this note disagrees with the spec

1. Staff get no direct `SELECT` on the new tables. All reads go through Express, because RLS cannot
   hide the owner-only flag columns (Q1).
2. `discount_source` becomes two amounts, `bundle_discount` and `owner_discount`. Both can apply to
   one sale, and the amounts explain the total on the receipt.
3. There is no separate `transaction_id` column on the sale: the sale `id` is the transaction id.
4. The bundle discount counts complete sets *k*, instead of "present or not" (Q3).
5. The discount base is the charged price, not the list price (Q3).
6. A live sale's `cashier_id` must be the session user. The spec only constrained queued sales.
7. `needs_owner` uses the trigger's `ST001` rather than a pre-check, so there is a single source of
   truth for "negative".

Found while writing this note (outside M3a, for the architect to schedule):

8. **Reservation creation can over-reserve.** `POST /admin/reservations` reads
   `product_variant_availability` and then inserts as a separate statement, with no lock. Two staff
   reserving the last unit at the same moment both pass the check. The M2c design note (Rule 2,
   "Variant Row-Locking on Reservation Creation") says the variant row is locked. The code does not
   do this. The fix is the `decrement_order_stock` pattern: a definer function that locks the variant
   row `FOR UPDATE`, checks, and inserts, with grants limited to `service_role`. At tens of
   reservations a week the race is rare. M3a does not depend on it, because the counter never
   creates reservations.

## 7. Migration order and rollback

Order: reference-type CHECK, then bundles, then counter tables, then functions, then the margin
report. Each step is deployable alone: the UI ships last, and nothing calls a function before it
exists. Rollback is forward-only, as in M2: a new migration disables the counter routes' functions
(`REVOKE` from `service_role`) without touching posted data.
