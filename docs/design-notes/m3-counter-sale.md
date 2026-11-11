# M3a Design Note: Counter Sale, Scan-or-Search, Bundles, Void

> **Approved by the owner (architect) on 2026-11-11**, after the Opus audit and the revision below.
> Implementation proceeds on `m3a/counter-sale`.

Spec: `docs/tasks/warehouse-m3-counter-sale.md`. Audit of the spec: `docs/audits/m3-spec-audit.md`.
Audit of this note: `docs/audits/m3a-design-note-audit.md` (12 findings). §8 says how each was handled.
Scope: **M3a only** (spec §2). M3b (offline queue) gets its own addendum before it starts, once §16.5 is
answered; §15 Q6 and everything "queued" is deferred there (audit A11).
§12 is already done (#7, #9), so implementation starts at spec §17 step 3.

This note is about 420 lines. It answers six open questions, repeats spec §14 for every rule it adds,
and answers a 12-finding audit. The earlier M2 notes were 365 to 1199 lines.

## 1. The shape in one paragraph

The device keeps the cart and shows the total. The total is computed by one shared TypeScript pricing
module, the same one Express uses (Q3). *Complete* sends one request. Express does the following:
- validates the session and the payload;
- prices the sale with the shared module;
- calls one definer function, `post_counter_sale`, with the service client.

That function locks the variants and computes the flags. It then writes the header, the lines and one
`counter_sale` movement per line in a single transaction. The movements' `transaction_id` is the
sale's own `id`.

If the stock guard refuses the movements, the sale is stored as `needs_owner` with no movements. The
owner then either posts it or voids it. A void writes compensating movements at the original
`posting_date`. The margin report finds counter revenue through `transaction_id` and signs every term
by `quantity_delta`.

## 2. Answers to spec §15

### Q1. Schema

New migrations, one concern each, all forward-only, in this order:

1. `…_drop_on_hand_check.sql`. `product_variants.on_hand` carries `CHECK (on_hand >= 0)` from M1, so
   `allow_negative_stock = true` has never worked: the trigger's unguarded `UPDATE` raises `23514`
   instead of going negative (audit A1). The trigger already enforces non-negative stock when the
   setting is off. This migration drops the CHECK, so the setting does what M2a meant. A
   live-ledger integration test turns the setting on, oversells by one, and asserts that
   `negative_stock_override = true`.
2. `…_m3_reference_type_counter_sale.sql`: adds `counter_sale` to
   `stock_movements_reference_type_check` (the part of §12 item 1 that was left for M3).
3. `…_m3_bundles.sql`
4. `…_m3_counter_sales.sql`
5. `…_m3_post_counter_sale.sql`, `…_m3_post_pending_counter_sale.sql`, `…_m3_void_counter_sale.sql`.
   One function per file keeps each under 200 lines (audit A10.5).
6. `…_m3_margin_report_counter_revenue.sql`

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
  quantity    integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (bundle_id, variant_id)
);

CREATE TABLE public.counter_sales (
  id                  uuid PRIMARY KEY,                      -- client-generated idempotency key
  sale_number         bigint NOT NULL UNIQUE DEFAULT nextval('public.counter_sale_number_seq'),
  payload_hash        text NOT NULL,                         -- md5 of the parsed request (Q2 step 1)
  sold_at             timestamptz NOT NULL,                  -- device clock, receipt only
  posting_date        timestamptz NOT NULL,                  -- now() in M3a
  payment_method      text NOT NULL CHECK (payment_method IN ('cash', 'card', 'other')),
  bundle_discount     numeric(12,2) NOT NULL DEFAULT 0 CHECK (bundle_discount >= 0),
  owner_discount      numeric(12,2) NOT NULL DEFAULT 0 CHECK (owner_discount >= 0),
  total_amount        numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  displayed_total     numeric(12,2) NOT NULL,                -- what the screen showed before payment
  total_mismatch      boolean NOT NULL DEFAULT false,        -- displayed_total <> total_amount
  note                text,
  cashier_id          uuid NOT NULL REFERENCES public.users(id),
  posted_by           uuid NOT NULL REFERENCES public.users(id),
  status              text NOT NULL CHECK (status IN ('posted', 'needs_owner', 'voided')),
  needs_owner_reason  text,
  resolved_by uuid REFERENCES public.users(id), resolved_at timestamptz,
  voided_by   uuid REFERENCES public.users(id), voided_at   timestamptz, void_reason text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_void_attribution CHECK (status <> 'voided' OR (voided_by IS NOT NULL AND voided_at IS NOT NULL
                                         AND void_reason IS NOT NULL AND char_length(trim(void_reason)) > 0)),
  CONSTRAINT chk_needs_owner_reason CHECK (status <> 'needs_owner' OR needs_owner_reason IS NOT NULL)
);
CREATE INDEX idx_counter_sales_posting_date ON public.counter_sales (posting_date DESC);
CREATE INDEX idx_counter_sales_open ON public.counter_sales (created_at) WHERE status = 'needs_owner';

CREATE TABLE public.counter_sale_lines (
  sale_id              uuid NOT NULL REFERENCES public.counter_sales(id) ON DELETE RESTRICT,
  line_no              integer NOT NULL CHECK (line_no > 0),
  variant_id           uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity             integer NOT NULL CHECK (quantity > 0),  -- M3a sells whole units (audit A3.6)
  list_unit_price      numeric(10,2) NOT NULL,      -- product_variants.price, read under the lock
  charged_unit_price   numeric(10,2) NOT NULL,      -- what the device showed
  bundle_id            uuid REFERENCES public.bundles(id) ON DELETE RESTRICT,
  net_line_total       numeric(12,2) NOT NULL CHECK (net_line_total >= 0),
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
Express, which drops the owner-only flags. This is stricter than spec §13, which gave staff `SELECT`.
Rows cannot hide columns, so a staff `SELECT` would expose the flags. The four tables are added to
`STAFF_TABLES` anyway, so a cost column can never appear on them. There are no `tenant_id` columns: one
shop per project (spec §3).

### Q2. `post_counter_sale`

```
post_counter_sale(p_sale jsonb, p_payload_hash text, p_session_user uuid)
  RETURNS jsonb   -- { id, sale_number, status, needs_owner_reason, replayed, lines: [{ line_no, flags }] }
SECURITY DEFINER; REVOKE FROM public, anon, authenticated; GRANT TO service_role
```

**Express, before the call.**
1. Validate the body with the generated Zod schema. Allowed fields: `id`, `sold_at`,
   `payment_method`, `note`, `owner_discount`, `displayed_total`, and `lines[{variant_id, quantity
   (integer), charged_unit_price, bundle_id}]`, at most 200 lines.
2. Reject `400` if a line is tagged with a `bundle_id` whose definition does not contain that variant,
   or if the bundle is inactive (audit A3.3, A3.5).
3. Read the bundle definitions for the tagged bundles.
4. Price the sale with the shared module (Q3): owner discount only if the session role is `admin`,
   otherwise 0.
5. Pass `p_sale`, the priced sale with `net_line_total` per line and the three header amounts.
6. Pass `p_payload_hash = md5` of the **Zod-parsed request**, serialised by Express. It is not the raw
   body and not the priced object, so a resend hashes the same (audit A10.3).
7. Pass the session user from the shared middleware.

The function body has no `auth.uid()`, as the invariant requires. Express is the trusted pricing side;
the device only displays.

**Inside the one transaction.**
1. **Idempotency.**
   - `SELECT … FROM counter_sales WHERE id = p_sale->>'id'`. If the sale exists: equal hash means
     return it with `replayed = true`; a different hash raises `ST020`.
   - Otherwise steps 2–5 run, and the header insert in step 6 uses `ON CONFLICT (id) DO NOTHING`. If a
     concurrent identical request won the race, no row is inserted. The function then re-selects and
     applies the same comparison (audit A10.1).
2. **Lock** the distinct variants `FOR UPDATE ORDER BY id`, the same order as `decrement_order_stock`.
   Reservation creation takes no lock today (§7, finding 8). `post_goods_receipt` and
   `post_stocktake` lock in other orders, so a deadlock with them is possible on a count day. Express
   retries the call once on `40P01`/`40001` with the same `id`; idempotency makes that safe (audit A7).
3. **Read** `price` and `on_hand`, and active reservations per variant with M2c's `effective_status`
   predicate.
4. **Check the pricing.** The function verifies that `Σ net_line_total = total_amount` and that every
   `net ≥ 0`, and raises `ST023` otherwise; a `400` would mean an Express bug. It sets
   `total_mismatch = (displayed_total <> total_amount)`. This is a flag, not a rejection (spec §4,
   audit A2).
5. **Flags.** All computed here from locked rows.
   - `price_mismatch`: `charged ≠ list`.
   - `reservation_override`: on every line of a variant where
     `on_hand − reserved − Σ quantity of that variant in this sale < 0`, and `reserved > 0`.
   - `posted_after_count` (Q7) is false for a live sale.
6. **Insert** the header and lines. `posting_date = now()`, `cashier_id = posted_by = p_session_user`.
7. **Movements.** The function runs this inside a `BEGIN … EXCEPTION WHEN SQLSTATE 'ST001' … END`
   block, which is a PL/pgSQL savepoint:
   - one movement per line, with `reason 'counter_sale'`, `reference_type 'counter_sale'`,
     `reference_id = id::text`, `transaction_id = id`, `posting_date`, and `actor_id = cashier_id`;
   - then `recompute_variant_cost(variant, posting_date)` once per distinct variant.

   On `ST001`, the savepoint rolls back the movements and the recompute. The header becomes
   `needs_owner` with reason `on_hand`, the lines stay, and the call succeeds. After the CHECK is
   dropped (Q1, migration 1), `ST001` is the only "would go negative" error the trigger can raise. With
   `allow_negative_stock` on, the sale posts and the movement is marked `negative_stock_override`.
8. **Return** the sale and its per-line flags.

**The till's side of idempotency.** After *Complete*, the cart is frozen until the outcome is known.
A timeout resends the same `id` and payload. A forgotten item goes on a new sale with a new `id`. This
avoids both `ST020` at the till and a double sale (audit A10.2).

**`post_pending_counter_sale(id, p_session_user)`**, owner-only, checked in Express. It takes the same
ordered lock pass, then runs step 7 at the sale's stored `posting_date`. It sets `posted_after_count`
(Q7) on the lines. If the stock is still short it raises `ST001` to the owner. On success it sets
`resolved_by` and `resolved_at`.

**`void_counter_sale(id, reason, p_session_user)`**, owner-only. It takes the same ordered lock pass.
- For a `posted` sale it runs `INSERT INTO stock_movements … SELECT … FROM stock_movements WHERE
  transaction_id = id AND quantity_delta < 0` with:
  - `+quantity`;
  - `reason 'counter_sale'`;
  - the same `reference_id` and `transaction_id`;
  - `correlation_id = sm.id`, the original **movement**, so the void is per movement and unambiguous
    when one variant sits on two lines (audit A5);
  - the original `posting_date`.

  It then recomputes from that date and sets `posted_after_count` (Q7).
- For a `needs_owner` sale it changes the status only.
- Voiding a `voided` sale raises `ST022`.

### Q3. Pricing and exact rounding

The rules live in one pure TypeScript module, `lib/counter-pricing`, with no I/O. The counter screen
uses it to show the total, and Express uses it to price the posting (audit A2). Amounts are integers
in qəpik. Line gross is `g_i = charged_unit_price_i × quantity_i`, and quantities are whole numbers.
The base is the **charged** price: revenue is the money taken, and a mismatch is flagged separately.

**Stage 1: bundles**, for each `bundle_id` on the lines (audit A3.1):
- `k = min over the bundle's definition ⌊tagged qty / defined qty⌋`.
- `D_b = k × max(0, Σ defined qty × charged price − bundle_price)`.
- `bundle_price NULL` gives `D_b = 0` by an explicit branch (A3.5).
- `D_b` is allocated over **that bundle's tagged lines**, with `g_i` as the base.
- Units tagged beyond *k* sets still share the discount. The skew stays within one bundle's
  variants, and the sale total is exact. This simpler rule was chosen over allocating to exactly
  *k* sets (A3.4, partly accepted).
- After stage 1, each line has `n1_i = g_i − share_i`.

**Stage 2: owner**, only from an admin session:
- `D_o = min(owner_discount, Σ n1)`.
- `D_o` is allocated over **all lines**, with `n1_i` as the base.
- `net_line_total_i = n1_i − share_i`.

**Allocation, both stages (largest remainder).**
1. If `D = 0` or the base sum is 0, every share is 0 (A3.2).
2. Otherwise `share_i = ⌊D × base_i / Σbase⌋`.
3. The remaining `D − Σshare` qəpik go one each to the largest fractional parts, ties by `line_no`.

Because each share is at most its base, every net is `≥ 0`, and the nets sum exactly to the total.

Unit tests (`pnpm test:unit`, offline) cover:
- a property test over random carts and discounts: the nets sum to the total and every net is `≥ 0`;
- two boxes in one sale; one box with an item removed;
- a free line, a `NULL` bundle price, and a bundle discount followed by an owner discount.

### Q4. Margin report

`get_margin_report` gets a new body. The signature and grants stay the same.
- `movement_sales` also selects `sm.transaction_id`.
- **Counter revenue.** `counter_line_prices` gives a price per `(sale_id, variant_id)`:
  `Σ net_line_total` and `Σ quantity` over sales in status `posted` or `voided`. It joins on
  `ms.reference_type = 'counter_sale' AND clp.sale_id = ms.transaction_id`, uuid to uuid with no cast.
  Revenue per movement is `ROUND(−delta × Σnet / Σqty, 2)`. The sale and its void round identically,
  so they still net to zero, and the daily revenue matches the receipts (audit A4).
- **Pick-ups.** A reservation has exactly one movement, so revenue is `agreed_price`. It joins on
  `r.id = CASE WHEN ms.reference_type = 'reservation' THEN ms.reference_id::uuid END`.
- **Orders.** The existing order join gets the same `CASE` guard on its cast (audit F13). The
  order revenue and COGS terms are unchanged.
- **Signs**, for counter and reservation terms: units `−delta`, cost `−SIGN(delta) × total_cost`.
  A sale and its void net to zero on units, revenue and cost.
- `is_priced` is true for counter and reservation terms when a price joined.
- **One visible change.** Pick-up movements posted before this migration were counted as
  `unpriced_units_out`. From this migration they are priced (A10.5). There are none in production,
  because pick-ups could not post before #9.

Test: in one day, a sale, its void and a pick-up. The report shows counter units at 0 and pick-up
revenue equal to `agreed_price`, and the online rows match a fixture taken before the migration.

### Q5. A void in a period the owner already viewed

The void posts at the sale's original `posting_date`, so that day's figures change after the fact and
the sale disappears from them. This is correct accounting, because the sale never happened. Nothing is
stored or closed per period today, so nothing goes stale, and the void list shows `voided_at` beside
the original date.

Voiding at `now()` would be worse: the old period would keep a sale that did not happen, and the
current period would show a negative one. If period closing is ever added, a void into a closed period
becomes a new decision.

### Q6. Snapshot and IndexedDB (M3b)

This is deferred to the M3b addendum, together with the queued path, the clock clamp and a
`clock_clamped` column (audit A11).

### Q7. Is `posted_after_count` enough?

Yes, for a movement posted at a date earlier than now. In M3a that is `post_pending_counter_sale` and
`void_counter_sale` (audit A6). The flag is set on a line when this holds:

```sql
EXISTS (SELECT 1 FROM stocktake_line_snapshots s
          JOIN stocktake_lines l ON l.id = s.line_id
          JOIN stocktakes st ON st.id = l.stocktake_id AND st.status <> 'cancelled'
         WHERE l.variant_id = line.variant_id AND s.captured_at > sale.posting_date)
```

The owner can tell the two cases apart by the sale's status: `voided`, or `posted` with
`resolved_at`. A better signal would need locations or per-count cut-off times, which are out of
scope.

## 3. API and screens

The endpoints are added to `lib/api-spec/openapi.yaml` and regenerated with Orval. The generated Zod
schemas do the validation.

| Endpoint | Role | Notes |
|---|---|---|
| `GET /admin/counter/lookup?q=` | staff | Barcode exact match first, reusing the scan query. Otherwise `ILIKE` on translation titles and SKU, max 20, with `%`, `_` and `,` escaped before building the PostgREST filter (audit A10.4). Returns option values, price, on_hand, available, and active reservation names where `available ≤ 0`. No cost. |
| `GET /admin/counter/bundles` | staff | Active bundles with lines, for the screen and pricing. |
| `POST /admin/counter/sales` | staff | Q2. `201` new, `200` replay. One retry on `40P01`/`40001`. |
| `GET /admin/counter/sales`, `…/:id` | staff / admin | Staff get no flags; admin gets flags. The receipt reads `GET :id`. |
| `POST /admin/counter/sales/:id/void` | admin | `{ reason }` |
| `POST /admin/counter/sales/:id/post-pending` | admin | |
| `GET /admin/counter/flagged` | admin | Lines with any flag, `total_mismatch` sales, and `needs_owner` sales. |
| `POST/PUT/DELETE /admin/bundles` | admin | Delete means `is_active = false` once a sale references the bundle. |

Deposit pick-up reuses `POST /admin/reservations/:id/fulfil`. The screen only adds a panel that finds a
reservation by number or phone.

`requireStaffOrAdmin` is copied in seven route files today (audit A9). The counter routes import a
single copy from a new `middlewares/requireStaffOrAdmin.ts`. The other six are left as they are, and
migrating them is listed as debt in the implementation notes. That keeps an auth refactor out of M3a.

Screens:
- `CounterPage`: built from `LookupBox`, `VariantPicker`, `CartLines`, `ReservationWarning` and
  `PickupPanel`, each under 200 lines. The lookup box keeps focus, so a keyboard-wedge scanner works
  without a tap.
- `CounterSalesPage`: a list, plus owner tabs for flagged and pending sales.
- `CounterReceiptPage`: print CSS for narrow paper.
- `BundlesPage`.

## 4. Spec §14 repeated for every rule this note adds

| Rule | Ordinary flow | Intersects |
|---|---|---|
| Drop `on_hand >= 0`; the trigger alone guards | Setting off: oversell → `ST001` → `needs_owner`. Setting on: posts, `negative_stock_override` | M1 guard; M2a `allow_negative_stock` (now real); spec §16.9 default off |
| Shared pricing module; Express prices, SQL checks sums | Screen shows 18.00, cash 18.00, recorded 18.00. Bundle price changed mid-shift: `total_mismatch` flag | M1 staff may not change prices; spec §4 flag-not-reject |
| `transaction_id = counter_sales.id`, void too | Three scans: three movements share the sale id; the void's movements share it as well | M1 `transaction_id` grouping (deviation, §6.8); Q4 join |
| Idempotency by `id` and hash; cart frozen until outcome | Timeout, resend: same sale, `replayed = true` | Spec §6; M3b resend |
| `cashier_id = posted_by = session` in M3a | Cashier signed in, sells | M1 "every movement records who"; M3b addendum adds queued cashiers |
| Ordered lock pass in all three functions; one retry | Two tills, last reserved unit: second waits, sees the first, flags override | `decrement_order_stock`; receipt/stocktake orders (retry covers them) |
| Override only when `reserved > 0` | Stock 0, no reservation: no override; the guard decides | Spec §8; `needs_owner` |
| `needs_owner` via `ST001` in a savepoint | System shows 0, unit in hand: sale stored, no movement | M1 guard; Q1 migration 1 |
| Two-stage discount on the charged price; nets ≥ 0 | Box sold whole: discount. One item removed: none. Owner adds 2 AZN on top: spread over nets | M1 price rule; spec §6, §10 |
| Staff read counter data only through Express | Staff list shows sales without flags | Spec §13 (stricter) |
| Void per original movement at the original date; flag after a count | Owner voids yesterday's wrong scan: yesterday nets to 0 | M2a replay; M2b delta posting; Q5, Q7 |
| Margin revenue rounded per movement; guarded casts | Three units at 10.00 net: 10.00, not 9.99… | Audit F13; M2a report |

## 5. Tests

These map to spec §17 item 7.

**Unit** (offline):
- the pricing module (Q3).

**Integration** (live ledger):
- dropping the CHECK: an oversell with the setting on;
- atomic posting;
- an idempotent replay, and `ST020` when the payload differs;
- two concurrency cases, each as parallel RPC calls:
  - `on_hand 2` with 1 reserved;
  - `on_hand 1`;
- the override flag is computed server-side even when the client lies;
- a staff session's discount is ignored;
- an incomplete bundle gets no discount;
- `price_mismatch` and `total_mismatch`;
- a sale plus its void nets to zero in the margin report;
- pick-up revenue shows the same day;
- `posted_after_count` is set on a void after a count, and not set for a cancelled count;
- `anon` and a shopper get `42501` on every new definer function;
- staff and shopper tokens get no `SELECT` on the four tables;
- staff get `403` on void, post-pending and owner discount.

**E2E:**
- scan, picker, *Complete*, receipt, at phone and desktop width.

**Migration testing** (`migrations.md`, audit A10.5): every migration runs in CI against the test
project, which has rows. No empty-database run is available locally, and the implementation notes will
say so.

## 6. Where this note disagrees with the spec

1. Staff get no direct `SELECT` on the new tables. All reads go through Express, because RLS cannot
   hide the owner-only flag columns.
2. `discount_source` becomes two amounts, `bundle_discount` and `owner_discount`. Both can apply to
   one sale.
3. There is no separate `transaction_id` column: the sale `id` is the transaction id.
4. The bundle discount counts complete sets *k*.
5. The discount base is the charged price.
6. In M3a, `cashier_id` is always the session user. Queued cashiers belong to M3b.
7. Pricing runs in Express through a shared module, and SQL checks the sums. The spec put the discount
   computation inside the function. That cannot show the cashier a total before payment (audit A2).
8. The void reuses the sale's `transaction_id`. M2a's `reverse_goods_receipt` gives a reversal its own
   transaction. Reuse is kept because the margin join and the owner's sale view both group by it, and
   `correlation_id` already links each void movement to its original (audit A5).
9. An extra migration drops `CHECK (on_hand >= 0)` (Q1 migration 1). The spec did not know the setting
   was broken.

## 7. Found while writing and auditing (outside M3a, for the architect to schedule)

8. **Reservation creation can over-reserve.** `POST /admin/reservations` reads
   `product_variant_availability` and then inserts as a separate statement, with no lock. So two staff
   reserving the last unit at once both pass. The M2c note's Rule 2 says the variant row is locked; the
   code does not do it. The fix follows the `decrement_order_stock` pattern: a definer function that
   locks, checks and inserts, granted to `service_role` only. M3a does not depend on it.
9. **`allow_negative_stock` never worked** (audit A1). M3a fixes this in Q1 migration 1, because the
   counter depends on it. Online orders and pick-ups had the same failure: an oversell with the setting
   on raised `23514` and rolled back.

## 8. Audit response (`docs/audits/m3a-design-note-audit.md`)

| Finding | Response | Where |
|---|---|---|
| A1 setting broken by the CHECK | Accepted: drop the CHECK, with a live test. The handler is not widened to catch `23514` | Q1, Q2 step 7, §7.9 |
| A2 total before payment | Accepted: a shared TypeScript pricing module, SQL checks the sums, a `total_mismatch` flag | §1, Q2, Q3 |
| A3 allocation | Accepted 1, 2, 3, 5, 6. Part 4 partly accepted: units beyond *k* still share the discount; the total is exact | Q3, Q2 Express step 2 |
| A4 rounding | Accepted: round per movement; a pick-up uses `agreed_price` | Q4 |
| A5 void ids | Accepted: void per original movement; `transaction_id` reuse listed as a deviation | Q2, §6.8 |
| A6 flag paths | Accepted: post-pending and void; cancelled counts excluded | Q7 |
| A7 locks | Accepted: lock pass in all three functions, one retry in Express | Q2 step 2 |
| A8 NULL reason | Accepted | Q1 |
| A9 seven copies | Accepted: only the new routes use a shared copy; the rest is listed as debt | §3 |
| A10 gaps | Accepted 1–5 | Q2, §3, §5, Q1 |
| A11 queued path | Accepted: out of M3a | Q2, Q6 |
| A12 rollback | Accepted: roll back by unmounting the Express counter routes, no migration | §9 |

## 9. Rollback

The functions stay `service_role`-only, so unmounting the Express counter routes, one line, makes them
unreachable without a migration. That keeps `audit:invariants:strict` green (audit A12). Posted data
stays.
