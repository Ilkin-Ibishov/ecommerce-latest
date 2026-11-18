# Delivery fee: a setting the shop owns

Status: active — ready for a design note; partly superseded by `delivery-cost-at-confirmation.md`. Its note is on `design/delivery-fee`, under review.

Spec, 2026-11-15. Written by the architect after the owner's decision of the same day: a delivery
fee can exist, and it must be something each shop can change or switch off.

## 1. Why this exists

The storefront promises "free delivery over 100 AZN" in four places and charges no delivery fee at
all: `routes/orders.ts` stores `total_azn = subtotal - discount`. The promise is a hard-coded `100`
in `CartDrawer.tsx` and in the three dictionaries. `fix/storefront-mobile-spa` then added a
hard-coded 5 AZN fee to the checkout page only — the customer is shown 104.99 and the order is
stored as 99.99 (`docs/audits/fix-storefront-mobile-spa-audit.md`, finding 1).

`store_settings` has had a `free_delivery_threshold` row since `20260606110418`. Nothing reads it.

## 2. Scope

Two settings, one computation on the server, one new column on the order, and the storefront shows
what the server computes. No zones, no weights, no courier (§11).

## 3. The invariant that defines this phase

> **The delivery fee is computed in one place, from the shop's settings, and the amount the
> customer is shown is the amount the order stores.** No number about delivery is written in
> storefront code or in a translation string.

## 4. Decisions already taken — do not re-litigate; flag if you believe one is wrong

- **Two settings, no separate on/off switch.**
  `delivery_fee` — an amount; `0` means the shop charges nothing and the feature is off.
  `free_delivery_threshold` — an amount; empty means delivery is never free.
- **Off by default.** `delivery_fee` ships as `0`, so a shop that changes nothing is charged
  exactly what it is charged today.
- **With the fee off, the storefront says nothing about free delivery.** No progress bar, no
  badge, no product-page line. "Free delivery over X" is only true where a fee exists below X.
- **The threshold is compared with the goods subtotal before any coupon.** The cart drawer tells
  the customer "add 12 AZN more for free delivery" before a coupon is entered; applying a coupon
  must not take that back.
- **The order stores its own fee.** `orders.delivery_fee_azn`, and
  `total_azn = subtotal - discount + delivery_fee_azn`. Changing the setting later changes no
  existing order.
- **The fee is not sales revenue.** Margin and sales reports count goods; the fee is shown
  separately or not at all, never inside margin.
- **Counter sales have no delivery fee.** The customer is at the till.
- **The settings are publicly readable.** The customer must see them; they are not secrets.

## 5. What the customer saw is what is charged

The owner can change the fee while a customer has the checkout page open.

- The order request carries the total the customer was shown. The server computes its own; if they
  differ it refuses with a conflict and returns the current numbers, and the page shows them and
  asks again. The counter sale already works this way (`displayed_total`).
- The storefront never computes the fee from its own constants. Whether it calls the server for a
  quote or shares one pure function with it is the design note's choice (§9.1); either way there
  is one implementation.

## 6. Every rule: ordinary flow and intersections

For each rule the design note writes both answers. The ones already visible:

| Rule | Ordinary flow | Meets |
|---|---|---|
| Fee below the threshold | Fee 5, threshold 100. A 60 AZN cart: goods 60, delivery 5, total 65. The courier collects 65 and the order says 65 | Coupons: 100 subtotal with a 30 coupon is still free. A coupon larger than the subtotal: the fee is still owed |
| Free at the threshold | A cart of exactly 100.00 pays no fee | Rounding: `numeric(10,2)` on both sides; 99.995 does not exist |
| Off means silent | Fee 0: checkout shows goods and total only, as today | The four places that say "100 AZN" today (§7). The test that asserts they all say 100 |
| No threshold | Fee 5, threshold empty: every order pays 5; nothing mentions free delivery | Cart drawer progress bar has nothing to measure |
| Order keeps its fee | Owner raises the fee to 7; yesterday's order still shows 5 | Order detail for customer and admin; the WhatsApp order message in `lib/notifications.ts`; order cancellation |
| Shown equals charged | Owner changes the fee during a checkout; the customer sees the new total before confirming | §5. A cart emptied by the price refresh: no fee on nothing |
| Not revenue | The margin report for the day is unchanged by fees | M2a margin, the admin dashboard totals, any export |

## 7. Where it appears

- Admin settings: the two fields, with validation (fee `>= 0`; threshold `> 0` or empty) and a
  sentence that says what the customer will see for the values entered.
- Cart drawer, checkout summary, order confirmation, the customer's order page, the admin order
  page: a delivery line whenever the fee setting is on — "Free" when earned, the amount otherwise.
- `TrustBadges`, `ProductDetail`, the announcement bar and the cart drawer take the threshold from
  the setting through `t()` interpolation. The literal `100` leaves `CartDrawer.tsx` and all three
  dictionaries.
- `i18n-consistency.test.ts` has a case asserting every free-delivery string mentions 100 AZN.
  It is **replaced**, not deleted: the new case asserts no dictionary string contains a delivery
  amount. This is the one test change this spec authorises.
- Frontend work follows `.agents/rules/frontend.md`: `modern-web-guidance` first.

## 8. What happens to `fix/storefront-mobile-spa`

Its two constants (`FREE_DELIVERY_THRESHOLD`, `STANDARD_DELIVERY_FEE`) and the delivery line in its
checkout summary are removed in that branch's own fix round. The fee arrives with this phase, not
with that one.

## 9. Open questions — answer in the design note, before any migration

1. One implementation of the computation: a server quote, or a pure function in a shared package
   used by both sides. Say which, and how the invariant check in §10.5 proves there is only one.
2. Which settings table. `free_delivery_threshold` is already in `store_settings`; the storefront's
   settings context and `site_settings` also exist. Do not create a third place.
3. `supabase/schema.sql` declares `orders.subtotal_azn NOT NULL`; `routes/orders.ts` does not set
   it on insert. Establish what the real table has before adding a column next to it
   (skill `schema-drift-check`).
4. Every reader of `orders.total_azn`: which of them must now show the fee separately, and which
   report must subtract it.
5. What the WhatsApp order message says when a fee is charged.
6. What the conflict response of §5 looks like and what the page does with it.

## 10. Deliverables, in order

1. **Design note first** at `docs/design-notes/delivery-fee.md`, answering §9 and repeating §6 for
   every rule. Commit it and **stop** for review.
2. Migration: `orders.delivery_fee_azn numeric(10,2) NOT NULL DEFAULT 0`, the `delivery_fee`
   setting seeded as `0`. One concern per file.
3. The computation and the order route, Zod-validated; the conflict of §5.
4. Admin settings fields; then the storefront surfaces of §7.
5. An invariant in `scripts/audit/check-invariants.mjs`: no numeric delivery constant under
   `artifacts/store/src/` outside tests, and no delivery amount in the dictionaries.
6. Tests at every tier. At least: fee off — order total equals today's; fee on, below, at and above
   the threshold; coupon cases from §6; setting changed between page load and submit gives the
   conflict and stores nothing; an old order keeps its fee after the setting changes; the margin
   report is unchanged by a fee; E2E: the total on the checkout page equals `total_azn` of the
   stored order.

## 11. Not in this phase

| Not built | Re-open when |
|---|---|
| Fees by zone, distance, weight or item | A shop delivers outside one city at a different price |
| Pickup from the shop with no fee | A shop offers collection |
| Free-delivery coupons | A shop asks for one |
| Courier integration, tracking, paying the courier | A shop uses a courier with an API |
| Fee on counter sales | Never, unless the till starts taking delivery orders |

## 12. Open questions for the customer

Engineering starts without these; each has a default that ships.

1. Is the threshold measured before or after a coupon? *Default: before (§4).*
2. Should the fee be refundable when an order is cancelled after dispatch? *Default: the product
   records no payment for online orders, so nothing is refunded by it.*

## 13. Definition of done

`pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants` pass. The migration applied
to the test project. Integration and E2E green in CI. `docs/audits/delivery-fee-notes.md` states
which tiers ran. No new file over 200 lines without the reason in the design note.

## 14. What is not verified

That nothing reads `free_delivery_threshold` comes from a grep of `main`, not from the running
app. The readers of `orders.total_azn` were not enumerated (§9.4). The live `orders` table was not
compared with `schema.sql` (§9.3). Whether any production shop's customers have already been told
a fee by a courier outside the product is unknown.
