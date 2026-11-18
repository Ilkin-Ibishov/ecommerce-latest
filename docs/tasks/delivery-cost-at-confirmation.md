# Delivery cost when the amount is not known at checkout

Spec, 2026-11-18. Written by the architect after the owner's decision of the same day: the
delivery amount is not a fixed number, it varies by region, and the shop does not know it when
the customer places the order.

**Read this before `docs/tasks/delivery-fee.md`.** That spec and its design note
(`docs/design-notes/delivery-fee.md`, branch `design/delivery-fee`, under review) assume the fee
is computed at checkout from one flat setting. Where the amount is unknown at checkout, the shape
below replaces that assumption: §3, §4 and §9 of this file take precedence over
`delivery-fee.md` §5, §9.2 and §10.2 and over the note's §3-§5. Everything else in the note still
holds and is not restated here — above all its removal of the hard-coded 100 AZN and its
"shown = charged" guard. Neither file was edited; both are architect-owned.

## 1. The fact this is built on

Payment is cash on delivery. `Checkout.cashPayment` reads "Nağd ödəniş · Çatdırılmada AZN ilə
ödəyin" (`messages/az.ts:214`), `lib/whatsapp.ts:71` sends "Ödəniş: Çatdırılmada nağd", and
`orders` carries no payment column and no gateway reference (`supabase/schema.sql:735-749`).

So the figure the checkout shows is a **quote, not a charge**. Nothing is collected online. That
is what makes an unknown delivery amount workable at all: the shop is not asking the customer to
authorise a number it cannot state.

It also means the quote must not pretend to be final. Today it does: the submit button renders
`${t("Checkout.placeOrder")} · ${total.toFixed(2)} AZN` (`CheckoutPage.tsx:299`) and the summary
prints a `Checkout.total` row (`:332`) over a delivery row hard-coded to `Checkout.free` (`:330`).

## 2. Intent

The customer always sees what the shop knows and never a number the shop cannot stand behind.
The delivery amount is agreed on the call that already happens, recorded on the order when it is
agreed, and from that moment it is part of every total the system reports.

The implementation is yours to propose. The invariants in §3, §6 and §10 are fixed.

## 3. The fee has three states, and the column must carry them

`orders.delivery_fee_azn numeric(10,2) NULL`:

| State | Meaning |
|---|---|
| `NULL` | Not yet determined. The shop has not spoken to the customer, or the region's tariff is not known |
| `0` | There is no delivery fee for this order — free delivery, or the shop does not charge one |
| `> 0` | The amount agreed for this order, fixed for its lifetime |

Nullable, against the design note's `NOT NULL DEFAULT 0`. The note weighed nullable only for
telling "earned free" from "fee off" and decided the `COALESCE` cost was not worth it; it did not
have this third state, which cannot be expressed any other way. `0` and `NULL` must stay
distinguishable: an order with no fee and an order whose fee nobody has set yet are different
facts, and the second one is a task for the owner.

`orders.total_azn` stays NOT NULL and keeps meaning **what the customer pays**. While the fee is
`NULL` it equals `subtotal_azn - discount_azn`. When the fee is set, `total_azn` is recomputed in
the same statement. No order ever carries a total that excludes a fee it has.

## 4. Checkout — what the customer sees

The order is placed before any delivery amount exists, so:

- The summary keeps its `Checkout.subtotal` and `Checkout.discount` rows (`CheckoutPage.tsx:328-329`).
- The delivery row (`:330`) shows **text, not a number**, under a new key: the fee for this order
  will be told to the customer when the order is confirmed. `Checkout.free` is not used there any
  more; a number appears on that row only in the case `delivery-fee.md` already covers — the shop
  has set a fee that applies to every order.
- The `Checkout.total` row (`:332`) is labelled as the goods amount, not the total, whenever the
  delivery row carries no number. Two numbers that do not add up to the third must never be shown
  under a heading that says they do.
- The submit button (`:299`) carries that same goods amount. It must not read as a final price.
- `Checkout.cashPayment` stays where it is: it is the sentence that makes the rest coherent.
- The confirmation screen uses the figure the server returned, not its local `placedTotal`
  (`:198`), as the design note already requires.

`displayed_total` and the `409 total_changed` refusal from the note's §4 are **kept**, covering
`subtotal - discount` only. They guard against product prices drifting between the cart and the
server, which is a live defect independent of delivery (note §1: the cart holds `products.price`,
the route charges the variant's price). Delivery is outside that comparison because at that
moment it does not exist.

## 5. Confirmation — where the amount is set

The flow already has the step: `order_status` runs
`pending → phone_verified → courier_assigned → shipped → delivered`
(`supabase/schema.sql:12-20`), and `phone_verified` is the call to the customer. That call is
where the region is known and the amount is agreed.

- `PATCH /admin/orders/:id/status` (`routes/admin/orders.ts:48`) accepts an optional delivery
  amount alongside the status. Setting it is allowed with any status change and on its own; it is
  **not** forced on `phone_verified`, because a shop that charges nothing should not have to type
  a zero. An order may reach `delivered` with the fee still `NULL` — that is a real state, and
  §10's invariants do not forbid it. It is the reporting in §6 that makes it visible.
- Validation: `>= 0`, two decimals, and a refusal once the order is `delivered`, `cancelled` or
  `refused_at_delivery` — the money question is closed by then. Changing an already-set fee on an
  open order is allowed and is an audited event.
- One statement writes `delivery_fee_azn` and the recomputed `total_azn`. Nothing else may write
  either column; see §10.
- `writeAudit` records it. The action name is yours to choose; `update_order_status` must not
  silently carry a money change, so the fee needs its own entry or its own `details` field that a
  reader can find. `order_status_history`
  (`20260624151313_create_order_status_history.sql`) records status only and is not extended.
- The customer is told. `sendWhatsAppStatusUpdate` (`lib/whatsapp.ts:76`) sends
  `statusMessages.phone_verified`, which today says only that the order is confirmed. When a fee
  above 0 was set, that message states the delivery amount and the new total. A fee set without
  the customer hearing it is the failure this spec exists to prevent.
- `sendWhatsAppOrderConfirmed(phone, orderId, itemCount, totalAzn)` (`:59`) is sent at order
  time, when the fee is `NULL`. Its `totalAzn` is the goods amount, and its text must not call it
  the total.

## 6. The fee is money, and it is not revenue

Every reader the design note lists in its §5 keeps the behaviour the note gives it — the fee is
subtracted from revenue figures, shown as its own column in the CSV export, and shown as its own
line in the admin and customer order views (`OrderDetailPage.tsx:208-212`,
`OrderTrackingPage.tsx:264`). `get_margin_report` stays untouched.

Two additions this spec makes, both because `NULL` exists:

- A `NULL` fee is not 0 in any sum. Every aggregate states which it is doing, and an order with a
  `NULL` fee is never counted as an order that had free delivery.
- The owner can see orders whose fee was never set. Where that surfaces is yours to propose; the
  M4b inbox (`docs/tasks/m4b-store-notifications.md`) is the obvious home and is not a dependency
  of this phase.

## 7. Settings

No new setting. A shop that knows its fee uses the two `site_settings` columns from the design
note's §2 and gets the note's behaviour; a shop that does not leaves them off and gets this one.
The two must not be two code paths: one quote function answers "is there a number for this order
at checkout time", and `NULL` is what it returns when there is not.

## 8. What this does not cover

- **Zones and regional tariffs.** Not now. An order stores its resolved amount, so a zone model
  later changes the quote function and nothing else — not this column, not the readers, not the
  receipt.
- **A city or region field.** `orders.delivery_address` is a single free-text column
  (`schema.sql:741`); there is nothing structured for a zone model to key on, and old orders
  cannot be classified after the fact. This should be its own small change, before any zone work
  and independent of this spec. It is named here so it is not forgotten, not to be built here.
- **The announcement bar.** Its text already exists as owner-editable settings nobody reads
  (`20260606110418_create_store_settings.sql:18-20`) while the bar renders the i18n string
  `AnnouncementBar.message`, which hard-codes 100 AZN (`messages/az.ts:143`). Separate change.
- **Online payment.** Out of scope entirely. If a gateway ever arrives, §1 stops being true and
  this spec is reopened: a charge cannot be a quote.

## 9. Data

One migration per concern, timestamped after the newest file in `supabase/migrations/`:

1. `orders.delivery_fee_azn numeric(10,2) NULL CHECK (delivery_fee_azn >= 0)`. No default —
   `NULL` is the meaning, not the absence of a choice. Existing rows stay `NULL`: no past order
   is claimed to have had free delivery.
2. Whatever the implementation needs to keep `total_azn` and the fee written together. A trigger
   is acceptable and so is one statement in the route; what is not acceptable is two writes that
   can land apart.

`database.types.ts` gains the column. The orders reconcile migration for `subtotal_azn` from the
design note's §8 is **already on `main`** (`24022d0`; the insert at `routes/orders.ts:137-149`
writes `subtotal_azn`), so it is not repeated here.

## 10. Invariants

New checks in `scripts/audit/check-invariants.mjs`, in the same commit as the code they guard:

1. `delivery_fee_azn` is written in exactly one place under `artifacts/api-server/src/`.
2. `total_azn` is written only where `delivery_fee_azn` is written, or where the order is created.
3. No `COALESCE(delivery_fee_azn, 0)` — or its TypeScript equivalent `?? 0` on that field — in
   any aggregate or report path. `NULL` must not be silently turned into free delivery.
4. No numeric literal assigned to an identifier containing `delivery` under `artifacts/store/src`
   (the design note's `delivery-fee-single-source`, which also removes `CartDrawer.tsx:9`'s
   `FREE_DELIVERY_THRESHOLD = 100`), and no digit in a dictionary string under a key containing
   `deliver` — which is what `freeDeliverySubtitle` (`:88`), `freeDeliveryOver` (`:114`) and
   `AnnouncementBar.message` (`:143`) violate today.

## 11. Tests

Integration, in the tier that has a database:

- An order is placed with the fee `NULL`; `total_azn` equals `subtotal_azn - discount_azn`.
- The fee is set to 7.50 on confirmation; `total_azn` moves by exactly 7.50 and the audit entry
  carries the change.
- The fee is set to 0; the order reads as "no fee", not as "not yet set", and no aggregate counts
  it with the `NULL` ones.
- A fee is refused on a `delivered` order and on a `cancelled` one.
- A fee is refused below 0 and at three decimals.
- Raising the shop-wide setting later does not move any stored order's fee or total.
- Revenue and the margin report are unchanged by a fee, and a `NULL` fee is not read as 0.

Offline: the quote function — no setting, a setting with no threshold, a setting with a threshold
above and below it, and the `NULL` answer.

E2E: a checkout whose summary carries no total it cannot support, and whose stored `subtotal_azn`
equals what the page showed.

## 12. For the owner

1. What the checkout delivery row should say in Azerbaijani, Russian and English. The meaning is
   "the amount is told to you when we confirm the order"; the wording is yours.
2. Whether the confirmation WhatsApp message states the amount and the new total, or only that
   the order is confirmed. This spec assumes it states them.
3. Whether an order may be delivered with the fee never set. This spec allows it and makes it
   visible rather than refusing it.

## 13. Not verified

`site_settings`, its context and `PATCH` validation, the revenue readers in `store-metrics.ts` and
`DashboardPage.tsx`, the CSV export and `get_margin_report` are cited from
`docs/design-notes/delivery-fee.md`, which read them; they were not re-read for this spec. Nothing
here was run against a database. The implementer confirms every column and status name against the
test project before writing a query, and stops on the first one that is missing.
