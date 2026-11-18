# Design note: delivery cost agreed at confirmation

> **Status:** proposed — architect-reviewed on the owner's delegation (2026-11-18); build after
> staff provisioning and M4b. **Author:** architect, 2026-11-18. **Spec:**
> `docs/tasks/delivery-cost-at-confirmation.md`. **Base:** `main` at `113612c`.
> **Absorbs** what is still current of `docs/design-notes/delivery-fee.md` (its §12 lists which
> parts); that note is not implemented on its own. Section numbers below are this note's.

## 0. Decisions in one screen

| Question | Answer |
|---|---|
| Fee column | `orders.delivery_fee_azn numeric(10,2) NULL CHECK (>= 0)`, no default (spec §3, §9.1) |
| Fee and total together | A `BEFORE INSERT OR UPDATE` trigger computes `total_azn` from `subtotal_azn`, `discount_azn`, `delivery_fee_azn`. No writer can store them apart, including the service role and SQL by hand (§2) |
| Writer of the fee | One function `set_order_delivery_fee` — update and audit line in one transaction (§3) |
| Goods must not move without a fee | A table `CHECK`, **valid**, not `NOT VALID` (§4) |
| Checkout with no known fee | Spec §13 strings; `quoteDelivery` returns `null` (§5) |
| Shop-wide fee setting | `site_settings.delivery_fee_azn` is **nullable**: `NULL` = not known at checkout (the default, this shop), `0` = always free, `> 0` = flat (§5) |
| Revenue | `sum(subtotal_azn − discount_azn)`. Goods only, so a `NULL` fee never enters a sum (§7) |
| Customer told | Two WhatsApp texts from spec §13, plus one new type for a fee set or changed after the confirmation call (§6) |

## 1. What holds on `main` (read 2026-11-18)

- `orders` on the test project holds **0 rows** (queried). No production exists
  (`docs/knowledgebase/supabase-projects.md`).
- `routes/orders.ts:145-147` inserts `subtotal_azn`, `discount_azn`, `total_azn = subtotal − discount`.
- `PATCH /admin/orders/:id/status` (`routes/admin/orders.ts:48-103`): reads the order, `update({ status })`,
  inserts `order_status_history`, restocks on cancel, queues `status_changed` with
  `{ order_id, status, old_status }`, `writeAudit` (`update_order_status`, not awaited). `requireAdmin`.
- `lib/notifications.ts:47-55` dispatches `order_confirmed` (`payload.total`) and `status_changed`
  (`payload.status` only) to `lib/whatsapp.ts:59-100`.
- Checkout: submit label `:299`, subtotal `:328`, delivery "Free" `:330`, total `:332`, local
  `placedTotal` used in the confirmation sentence `:216`.
- `POST /products/prices` returns `products.price` (`routes/products.ts:20-37`). The checkout refresh
  calls `updateQty` only (`CheckoutPage.tsx:86,94`). The order route charges the variant price.
  Shown ≠ charged is possible for goods today (delivery-fee note §1).
- Revenue readers: `store-metrics.ts:91-105`, `DashboardPage.tsx:110-122,152-153,194`. CSV
  `routes/admin/orders.ts:16-45`. Detail: `OrderDetailPage.tsx:208-212`, `OrderTrackingPage.tsx:264`
  (select at `routes/orders.ts:277`).
- `CartDrawer.tsx:9` `FREE_DELIVERY_THRESHOLD = 100`; dictionaries hard-code 100 under
  `freeDeliverySubtitle`, `freeDeliveryOver`, `AnnouncementBar.message`.
- `site_settings` is one row (`CHECK (id = …0001)`), public read; `PATCH /site-settings` validates
  per field through `VALID_FIELDS` (`routes/site-settings.ts:19-29`).
- `ST05x` error codes: unused (`git grep`).

## 2. Fee and total cannot land apart

Migration `…_orders_delivery_fee.sql`:

```sql
ALTER TABLE public.orders ADD COLUMN delivery_fee_azn numeric(10,2) NULL
  CHECK (delivery_fee_azn >= 0);
CREATE FUNCTION public.orders_compute_total() RETURNS trigger LANGUAGE plpgsql
  SET search_path = '' AS $$
BEGIN
  NEW.total_azn := NEW.subtotal_azn - NEW.discount_azn
    + CASE WHEN NEW.delivery_fee_azn IS NULL THEN 0 ELSE NEW.delivery_fee_azn END;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_orders_compute_total BEFORE INSERT OR UPDATE OF
  subtotal_azn, discount_azn, delivery_fee_azn, total_azn ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_compute_total();
```

The spec allows "a trigger or one statement". The trigger wins: it also covers the route bypassed,
and `total_azn` keeps meaning *what the customer pays* (a `NULL` fee adds nothing, spec §3). The
route still computes the total for its response; the trigger is the authority. `CASE` instead of
`COALESCE` keeps the invariant in §9.3 a plain text match. Ordinary flow: insert with fee `NULL`
→ total = goods. Intersection: a coupon write-back or a later fee change recomputes; the
cancel-restock path writes `status` only, so the trigger does not fire for it.

## 3. The writer: `set_order_delivery_fee`

Migration `…_set_order_delivery_fee.sql`. `set_order_delivery_fee(p_actor uuid, p_order uuid,
p_fee numeric) RETURNS TABLE (old_fee numeric, new_fee numeric, total_azn numeric, status text)`:
`SELECT … FOR UPDATE`; no row → `ST050`; status in `delivered | cancelled | refused_at_delivery`
→ `ST051` ("the money question is closed", spec §5); same fee → return, write nothing; else
`UPDATE … SET delivery_fee_azn = p_fee` (trigger sets the total) and
`INSERT INTO audit_log (actor_id, action 'set_delivery_fee', entity 'order', entity_id,
changes {old_fee, new_fee, old_total, new_total})` in the same transaction. Not
`SECURITY DEFINER`; `SET search_path = ''`; `EXECUTE` to `service_role` only. It follows
`set_user_role` (staff provisioning) on purpose: a money change is never a fire-and-forget audit
line, and `update_order_status` never carries one (spec §5).

## 4. The rule in the database

Migration `…_orders_fee_before_dispatch.sql`:
`ALTER TABLE orders ADD CONSTRAINT chk_orders_fee_before_dispatch CHECK (status NOT IN
('courier_assigned','shipped','delivered') OR delivery_fee_azn IS NOT NULL);` **valid.**

**Deviation from spec §9.3 (`NOT VALID`).** That clause protected a production database that might
hold delivered orders from before the column. There is none, the test project has 0 orders, and a
future production is built from these migrations, so a valid constraint holds everywhere. If
production is ever restored from an older dump, that import adds `NOT VALID` then.

## 5. Checkout and the quote

`site_settings` migration: `delivery_fee_azn numeric(10,2) NULL CHECK (>= 0)` and
`free_delivery_threshold_azn numeric(10,2) NULL CHECK (> 0)`, both `NULL` on the single row.
**Deviation from the delivery-fee note §2** (`NOT NULL DEFAULT 0`): with the third state, `0` must
mean "free" and only `NULL` can mean "not known at checkout". `VALID_FIELDS` gains both, validated
as two-decimal non-negative numbers or `null`. Delete the unread `store_settings` row
`free_delivery_threshold` in the same migration (note §2).

New package `lib/order-pricing` (`@workspace/order-pricing`, built like `lib/counter-pricing`),
qəpik integers throughout:

```ts
type DeliveryQuote = null                       // not known at checkout: spec §13 text, no number
  | { fee: number; remaining: number | null };  // fee 0 = free; remaining to the threshold
export function quoteDelivery(goodsSubtotal: number, s: DeliverySettings): DeliveryQuote;
```

`null` when the setting is `NULL`. Otherwise fee = setting, 0 when a threshold exists and goods ≥
threshold (coupon ignored, note §6). Server and storefront import the same function.

- **Quote `null`** (this shop): delivery row = "Təsdiq zamanı bildirilir"; total row and submit
  button = "Məhsulların məbləği · X AZN"; the explaining sentence under the summary. The order is
  inserted with `delivery_fee_azn` `NULL`.
- **Quote a number**: delivery row shows it (or "Free"), total includes it, the order is inserted
  with that fee.
- `displayed_total` (required) is compared with `subtotal − discount` in qəpik **before**
  `decrementOrderStock`; mismatch → `409 total_changed` with the server's numbers and per-product
  prices (delivery-fee note §4). **Addition beyond spec §4:** an optional `displayed_delivery_fee`
  compared with the server's quote when the quote is a number, under the same 409. It costs one
  comparison and stops a mid-checkout fee change being charged silently.
- Same commit (note §4.6, still needed): `POST /products/prices` returns the default variant's
  price, and the checkout refresh sets the price (`setPrice` cart action), not only the quantity.
  Without it the new check would keep refusing a cart with an old price.
- The confirmation screen shows the server's response figures, not `placedTotal`.

## 6. Confirmation: where the amount is set

`PATCH /admin/orders/:id/status` body becomes `{ status?, delivery_fee_azn? }` (at least one),
Zod: fee a string matching `^\d{1,8}(\.\d{1,2})?$` (two decimals, `>= 0`, spec §5), status from
`VALID_STATUSES`. Order of work:

1. Fee present → `set_order_delivery_fee`. `ST050` → 404 `not_found`; `ST051` → 409 `fee_closed`.
2. Status present → refuse `courier_assigned | shipped | delivered` while the fee (after step 1) is
   `NULL`: 409 `delivery_fee_required`. The database `CHECK` (`23514`) maps to the same code, so a
   race between two admins gives one answer. Then the existing status path unchanged.
3. Notifications: when the status moves to `phone_verified`, the `status_changed` payload gains
   `delivery_fee` and `total` read **after** step 1, and `sendWhatsAppStatusUpdate` appends the
   spec §13 lines (fee > 0, or "pulsuz" at 0; nothing when `NULL`). When the fee is written and the
   order is past `pending` but this request does not move it to `phone_verified`, a new type
   `delivery_fee_set` sends the same two lines. Without that type, a fee agreed after the call
   reaches nobody — the failure spec §5 names. The type is added to `NotifType` and dispatched (the
   invariant `no-undispatched-notification-type` checks it).
4. `sendWhatsAppOrderConfirmed` at order time: spec §13 text; the amount is the goods amount.

The route stays `requireAdmin`. Staff recording the fee needs staff to read orders, which staff
provisioning (A1) keeps admin-only — see §11.

## 7. Readers

| Reader | Change |
|---|---|
| `store-metrics.ts` revenue | `sum(subtotal_azn − discount_azn)` |
| `DashboardPage.tsx` cards, chart | Same, selecting `subtotal_azn, discount_azn` |
| CSV export | New "Delivery (AZN)" column: empty for `NULL`, `0.00` for 0 |
| Admin `OrderDetailPage` | Delivery line: amount, "Free", or **"Not set"** with the input that calls the route; the status control shows the 409 code as text |
| Customer `OrderTrackingPage` (+ select at `orders.ts:277`) | Delivery line: amount, "Free", or the spec §13 "told at confirmation" text |
| Admin `OrdersPage` | A "fee not set" badge on rows with `NULL` fee past `pending` — the owner's to-do (spec §6) until M4b adds it to the inbox |
| Lists of amounts paid, `get_margin_report` | Unchanged (margin reads `order_items`) |

## 8. Every rule: ordinary flow and intersections

| Rule | Ordinary | Meets |
|---|---|---|
| Three states | Order placed: `NULL`. The call: owner types 7.50, sets `phone_verified`; total + 7.50 | `0` reads "Free" everywhere and never counts as "not set"; `NULL` is never summed (revenue is goods) |
| Before goods move | `courier_assigned` with `NULL` → 409; with 0 → allowed | Route bypassed: `CHECK` raises. `cancelled`/`refused_at_delivery` reachable with `NULL` |
| Closed money | Fee change on a `delivered` order → 409 `fee_closed` | Changing an open order's fee is allowed, audited, and messaged (`delivery_fee_set`) |
| Customer told | One message at confirmation with fee and total | Fee set before the call: carried by the `phone_verified` message. After it: `delivery_fee_set` |
| Shown = charged | Goods price changed mid-checkout → 409, refreshed, resubmit | Flat-fee shop: setting changed mid-checkout → same 409 |
| Order keeps its fee | Setting raised later; stored orders unchanged | The trigger fires only on that row's own writes |
| No literal 100 | Drawer, badges, product page read the threshold from settings; with none, they say nothing about free delivery | `PoliciesPage` flat-rate sentence deleted in three languages (owner, 2026-11-18). `AnnouncementBar` stays as is: its content is the owner's open question |

## 9. Invariants (spec §10)

1. `delivery_fee_azn` written only by `set_order_delivery_fee` and the order insert in
   `routes/orders.ts`. 2. `total_azn` written by no code under `artifacts/` except that insert.
3. No `COALESCE(delivery_fee_azn` and no `delivery_fee_azn ?? 0` anywhere under `artifacts/` or in
   migrations. 4. The delivery-fee note's `delivery-fee-single-source` (no numeric literal on a
   `delivery` identifier in `artifacts/store/src`; no digit under a `deliver` dictionary key).
5. `orders.status` written only by `routes/admin/orders.ts` and the existing cancel-restock path.

## 10. Commits and tests

Migrations (fee column + trigger; `set_order_delivery_fee`; `CHECK`; `site_settings` columns) →
`database.types.ts` → `lib/order-pricing` with offline tests (`null`; flat; threshold below/at/
above; 99.99/100.00; coupon ignored) → order route → `/products/prices` + `setPrice` → admin route +
notifications → checkout and storefront surfaces + dictionaries (spec §13 text verbatim; the
`i18n-consistency.test.ts:82-97` case replaced as spec authorises) → readers → invariants →
integration tests in `tests/serial/` (spec §11 list, all of it) → E2E: the checkout summary carries
no total it cannot support and the stored `subtotal_azn` equals what the page showed (the first E2E
that places an order) → `docs/audits/delivery-cost-notes.md`.

## 11. Blocked / Assumptions / Not verified

- **For the owner, does not block this phase:** staff recording the fee (the owner's words, spec §5)
  needs staff to read and update orders. Staff provisioning keeps orders admin-only. Opening them to
  staff is a separate decision: it shows staff customers' names, phones, addresses and totals.
- **Checked on the test project (2026-11-18):** `subtotal_azn`, `discount_azn` (default 0) and
  `total_azn` are all `numeric NOT NULL`; `status` is the enum `order_status`, so the `CHECK` and
  the function compare against its labels.
- **Not verified:** nothing here was run. The builder confirms `site_settings` and `orders` columns
  against the test project schema dump before writing SQL and stops on a mismatch. The WhatsApp
  provider accepting the longer message was not checked.

Files over 200 lines: none planned. Tests deleted: none; one i18n case replaced as the spec allows.
