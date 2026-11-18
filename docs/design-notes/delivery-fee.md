# Design note: delivery fee as a shop setting

> **Status:** partly superseded — not implemented on its own (review 2026-11-18, §12).
> **Author:** architect (main session), 2026-11-15. **Branch:** `design/delivery-fee`.
> **Spec:** `docs/tasks/delivery-fee.md`. **Base:** `main` at `b351412`.

## 0. Decisions in one screen

| Question (spec §9) | Answer |
|---|---|
| 1. One implementation | A pure function in a new package `lib/order-pricing` (`@workspace/order-pricing`), built like `lib/counter-pricing`; the server and the storefront import it. Invariant in §7 |
| 2. Settings table | **`site_settings`**, two typed columns — not `store_settings` (reasons in §2) |
| 3. `orders.subtotal_azn` | Exists on the test project, `NOT NULL`, no default; the route never writes it, so **`POST /orders` cannot succeed there today**. One reconcile migration; production unknown (§10) |
| 4. Readers of `total_azn` | Three subtract the fee, one export gains a column, three detail views gain a line, four lists stay (§5) |
| 5. WhatsApp | One extra line `🚚 Çatdırılma: X ₼` when the order's fee is above 0; the total line stays what the courier collects |
| 6. Conflict | `displayed_total` in the request; mismatch → 409 `total_changed` with the server's numbers, before any stock moves (§4) |

## 1. What the code does today (read, not assumed)

- `routes/orders.ts:116` `totalAzn = subtotal - discountAmount`; the insert at `:137-148` writes
  `discount_azn`, `total_azn` and **no `subtotal_azn`**. The goods price is the default variant's
  (`:53-55`, `:66`); the checkout sends no `variant_id` (`CheckoutPage.tsx:159`).
- Test project `jcvsnoiacrknzejouxah`, queried read-only 2026-11-15: `orders.subtotal_azn numeric
  NOT NULL`, no default; only trigger `trg_orders_updated_at`; **0 rows in `orders`**. The generated
  `database.types.ts` has no `subtotal_azn`, which is why the insert typechecks.
- `tests/orders.test.ts:83` reads an undeclared `verify`; the `ReferenceError` sets `setupFailed` and
  every orders integration test skips. CI logs show it on every run (`Setup failed: ReferenceError`).
  No E2E spec submits an order. Nothing has exercised order creation against this database.
- `CheckoutPage.tsx:44-67` refreshes prices from `POST /products/prices`, which returns
  `products.price` (`routes/products.ts:20-37`), and on a price change calls `updateQty` — the cart
  keeps the old price. The server charges `variant.price`. The admin product route keeps the default
  variant's price in step (`routes/admin/products.ts:160-174`), but the cart in `localStorage` does
  not. Shown ≠ charged is already possible for goods.
- `calculateDiscount` caps the discount at the subtotal (`lib/coupon-calc.ts:29`).
- `CheckoutPage.tsx:297` always shows "Delivery: Free". `CartDrawer.tsx:9` is the constant `100`;
  the dictionaries hard-code 100 in `TrustBadges.freeDeliverySubtitle`, `ProductDetail.freeDeliveryOver`
  and `AnnouncementBar.message` (`messages/*.ts:88,114,143`). `PoliciesPage.tsx:2-4` says "Delivery fee
  is calculated at a flat rate" in three languages — false while the fee is off. The spec missed it.
- `t()` takes only a key (`lib/i18n/context.tsx:6`); placeholders use `.replace("{amount}", …)`
  (`CheckoutPage.tsx:183`).
- `store_settings.free_delivery_threshold` (`20260606110418_create_store_settings.sql:9`) has no
  reader outside migrations and docs (`git grep`).

## 2. Settings: `site_settings`, typed

The spec points at `store_settings`. I propose `site_settings` instead, and deleting the unread
`store_settings` row so there is still one place.

- `store_settings.value` is `text NOT NULL`: "empty threshold" would be a sentinel string and every
  reader parses text. `site_settings` takes typed columns with `CHECK`s, so the database refuses a
  negative fee, and `allow_negative_stock` (`20261104100000_m2a_schema_tables.sql:253`) set the precedent.
- The storefront already loads `site_settings` on every page through `lib/settings/context.tsx`
  (`GET /api/site-settings`, stale-while-revalidate cache). `store_settings` has no public route.
- The admin Settings page edits `site_settings` in tabs (`SettingsPage.tsx:223-225`), so a
  "Delivery" tab fits; `PATCH /api/site-settings` already validates per field (`VALID_FIELDS`).
- Cost: one migration deletes a row. Nothing reads it.

New columns (names mine, following the `_azn` suffix of `orders`):
`delivery_fee_azn numeric(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee_azn >= 0)` and
`free_delivery_threshold_azn numeric(10,2) NULL CHECK (free_delivery_threshold_azn > 0)`.
The threshold is seeded with `100` — the shop's current promise — and has no effect while the fee is 0.

## 3. The computation — `@workspace/order-pricing`

```ts
interface DeliverySettings { delivery_fee_azn: number; free_delivery_threshold_azn: number | null }
type DeliveryQuote =
  | { on: false }                                         // fee 0: say nothing about delivery
  | { on: true; fee: number; remaining: number | null };  // remaining to free; null = no threshold or earned
export function quoteDelivery(goodsSubtotal: number, s: DeliverySettings): DeliveryQuote;
export function orderTotal(subtotal: number, discount: number, fee: number): number;
```

All arithmetic in whole qəpik (`Math.round(x * 100)`), as `counter-pricing` does. Fee rule:
`fee > 0 && subtotal > 0 && (threshold == null || subtotal < threshold)` → the fee, else 0.
`orderTotal` = `subtotal − discount + fee`, rounded. The threshold sees the goods subtotal only (§4 of
the spec), so a coupon never takes free delivery back. The server is the authority; the storefront
calls the same function to *show*. A server quote endpoint was rejected: the cart drawer would need
a request per quantity change, for a rule that is three comparisons.

## 4. The order route and the conflict (spec §5)

1. `OrderBodySchema` (`routes/admin/schemas.ts:108`) gains `displayed_total: z.number().nonnegative()`,
   **required**. A tab open across a deploy gets 400 and a reload fixes it; optional would let the
   invariant go unchecked.
2. The route reads `site_settings` (one row), computes `subtotal`, `discount`, `fee`, `total` with the
   package, and compares `displayed_total` with `total` in qəpik — **before** `decrementOrderStock`
   (`orders.ts:125`), so a refusal moves no stock and writes no row.
3. Mismatch → `409 { error: "total_changed", subtotal, discount, delivery_fee, total, prices }`, where
   `prices` maps `product_id` → the unit price the server charges.
4. Insert writes `subtotal_azn`, `delivery_fee_azn`, `total_azn`. The 201 response adds `total` and
   `delivery_fee`, and the confirmation screen shows those instead of its local `total`.
5. The page, on 409: sets each line's price from `prices` (new cart action `setPrice`), revalidates
   settings (expose the existing `revalidate` from the settings context), shows "The total is now
   X AZN" above the button, and lets the customer submit again. A cart emptied by the refresh has no fee.
6. Same commit: `POST /products/prices` returns the default variant's price — the one the order route
   charges — and the checkout refresh sets the price, not only the quantity. Without this the new
   check would refuse every order whose cart holds an old price, and keep refusing it.

## 5. Readers of `orders.total_azn` (spec §9.4)

| Reader | Change |
|---|---|
| `routes/store-metrics.ts:91-105` — revenue for the control plane | Sum `total_azn − delivery_fee_azn` |
| `DashboardPage.tsx:135-136, 177` — revenue cards and chart | Same; select `delivery_fee_azn` |
| `routes/admin/orders.ts:21-37` — CSV export | New "Delivery (AZN)" column |
| `OrderDetailPage.tsx:208-212` (admin), `OrderTrackingPage.tsx:264` (customer; select at `orders.ts:276`), checkout confirmation | Delivery line when the order's fee > 0 |
| `OrdersPage.tsx:123`, `OrderCard.tsx:97`, `DashboardPage.tsx:547`, `lib/queries/orders.ts` | Unchanged — the amount paid is the right number in a list |
| `get_margin_report` | Unchanged: reads `order_items.line_total` (`20261111120800_margin_report_live_schema.sql:43-45`). A test asserts it |

Stored orders show a delivery line only when their fee is above 0. The spec asks for "Free when
earned" there too, but with `NOT NULL DEFAULT 0` (spec §10.2) an order cannot tell "earned free"
from "fee off", and reading today's setting would break "the order keeps its fee". Making the column
nullable (NULL = off, 0 = earned) would distinguish them at the price of `COALESCE` in every sum.
I recommend the simple column; "Free" shows live in the drawer, checkout and confirmation.

## 6. Every rule — ordinary flow and intersections (spec §6)

| Rule | Ordinary | Meets |
|---|---|---|
| Fee below threshold | Fee 5, threshold 100, cart 60 → 60 + 5 = 65 stored and shown | Coupon 30 on a 100 cart: free (threshold sees 100). Coupon ≥ subtotal: discount capped at subtotal, total = fee |
| Free at threshold | 100.00 → fee 0 | Qəpik integers on both sides; 99.99 pays, 100.00 does not |
| Off is silent | Fee 0: drawer, checkout, badges, product page and announcement bar say nothing about delivery; total as today | The 100-AZN strings go (§7); `CheckoutPage.tsx:297` "Free" goes; `PoliciesPage` flat-rate sentence goes or is reworded (owner, §10) |
| No threshold | Fee 5 on every order; nothing says "free" | Drawer has no progress bar (`remaining: null`) |
| Order keeps its fee | Fee raised to 7; yesterday's order still shows 5 | Customer and admin detail read `delivery_fee_azn`; WhatsApp payload carries the fee at queue time; cancellation touches no amount |
| Shown = charged | Owner changes the fee mid-checkout → 409, page shows the new total, customer confirms | Cached settings (5-min stale window) are caught by the same 409; an emptied cart pays nothing |
| Not revenue | Margin report unchanged by fees | Control-plane revenue and dashboard subtract the fee; CSV shows it apart |

Counter sales: untouched — no column, no setting read.

## 7. Storefront surfaces and the invariant

- Every surface takes `quoteDelivery(subtotal, settings)`: `CartDrawer` (progress bar and line 270),
  `CheckoutPage` summary, `TrustBadges` (free-delivery badge hidden unless fee > 0 and a threshold
  exists), `ProductDetail.tsx:313`, `AnnouncementBar` (renders nothing when there is nothing true to
  say — its only message is about delivery). Amounts go in through `{amount}` placeholders.
- Admin: a `DeliveryTab.tsx` in Settings — two inputs, a live sentence ("Customers pay 5.00 AZN;
  free from 100.00 AZN" / "No delivery fee is shown or charged"). `SettingsPage.tsx` is already 264
  lines, so the tab lives in its own file under `pages/admin/settings/`.
- `i18n-consistency.test.ts:82-97` is **replaced** (spec §7): no string under a key containing
  `deliver` holds a digit, in any of the three dictionaries.
- Invariant `delivery-fee-single-source` in `scripts/audit/check-invariants.mjs`: under
  `artifacts/store/src` (tests excluded) no identifier containing `delivery` (any case) is assigned
  a numeric literal; no dictionary string under a `deliver` key contains a digit; `quoteDelivery`
  and `orderTotal` are defined only in `lib/order-pricing`.
- Frontend commits start with `modern-web-guidance` `search`/`retrieve` (`.agents/rules/frontend.md`).
  `<input type="number" step="0.01" min="0">` for the two fields.

## 8. Migrations — one concern each

1. `…_orders_subtotal_azn_reconcile.sql` — `ADD COLUMN IF NOT EXISTS subtotal_azn numeric(10,2)`;
   `UPDATE … SET subtotal_azn = total_azn + discount_azn WHERE subtotal_azn IS NULL`; `SET NOT NULL`.
   Correct on either shape of the table; before this phase `total = subtotal − discount` held.
2. `…_orders_delivery_fee.sql` — `delivery_fee_azn numeric(10,2) NOT NULL DEFAULT 0 CHECK (>= 0)`.
3. `…_site_settings_delivery.sql` — the two columns of §2; threshold set to 100 on the single row;
   `DELETE FROM store_settings WHERE key = 'free_delivery_threshold'`.

Each is created on Postgres in a rolled-back transaction before I ask to apply it (orchestrator rule).
`database.types.ts` gains the five columns, matched to generator output.

## 9. Commits, in order

1. Fix `tests/orders.test.ts:83` (declare the lookup it reads; no assertion changes) — it must run
   before anything below can be trusted. 2–4. The three migrations. 5. `database.types.ts`.
6. `lib/order-pricing` + unit tests (off; below/at/above; no threshold; coupon < and ≥ subtotal;
   empty cart; 99.99/100.00). 7. Order route: settings read, `subtotal_azn`, fee, `displayed_total`,
   409, response fields. 8. `/products/prices` default-variant price + checkout price refresh +
   `setPrice`. 9. `PATCH /site-settings` validation + `DeliveryTab`. 10. Storefront surfaces.
11. Dictionaries + replaced i18n case. 12. Readers of §5 + WhatsApp line. 13. Invariant.
14. Integration tests in `tests/serial/` (the setting is global; CI runs that project,
   `test.yml:124-125`): fee off = today's total; on below/at/above; coupon cases; 409 stores nothing
   and moves no stock; old order keeps its fee; margin unchanged. 15. E2E: the checkout's displayed
   total equals the stored `total_azn` — the first E2E that places an order. 16. `docs/audits/delivery-fee-notes.md`.

## 10. Blocked / Assumptions / Not verified

**Blocked**
- Production's `orders` shape is unknown (no access). The owner or someone with access runs:
  `select column_name, is_nullable, column_default from information_schema.columns where table_name = 'orders';`
  If production has `subtotal_azn NOT NULL` like the test project, **online orders fail in production
  today** and commit 1–2 is urgent on its own. Migration 1 is written to be safe either way.

**Assumptions**
- One shop per Supabase project, so `site_settings` (single row, `CHECK (id = …0001)`) needs no tenant column.
- Seeding the threshold at 100 matches the owner's intent; it does nothing until a fee is set.
- `AnnouncementBar` may render nothing when the fee is off. If the owner wants the bar kept, it needs
  other content — not in this phase.
- The WhatsApp text stays Azerbaijani-only, as today (`lib/whatsapp.ts:67-72`).

**Not verified**
- That `POST /orders` fails on the test project — inferred from the column, the route and zero rows;
  commit 1 will show it.
- Whether any real product's `products.price` differs from its default variant's price.
- Whether customers were told a fee outside the product (spec §14).
- Nothing executed: no SQL beyond the two read-only queries above, no tests.

**For the owner:** the `PoliciesPage` delivery sentence (remove, or "set by the shop" wording?); the
`store_settings.announcement_message_*` rows also say 100 AZN and nothing reads them — delete later.

## 11. Spec points that do not match the code

- §5 "The counter sale already works this way": `post_counter_sale` records `total_mismatch` and posts
  (`20261113230400_post_counter_sale_payments.sql:59`); it does not refuse. Refusing is still right online.
- §7 "through `t()` interpolation": `t()` has no parameters; placeholders are replaced by the caller.
- §7 "Free when earned" on stored orders conflicts with §10.2's column — §5 above.
- §9.2 lists `store_settings`; §2 argues for `site_settings`.
- §1 cites `docs/audits/fix-storefront-mobile-spa-audit.md`, which is on `audit/storefront-mobile-spa`, not `main`.

Files over 200 lines: none planned. Tests deleted: none; one case replaced as the spec authorises.

## 12. Review — 2026-11-18 (architect, on the owner's delegation)

`docs/tasks/delivery-cost-at-confirmation.md` (owner's decision of 2026-11-18: the delivery amount
is agreed on the confirmation call) replaces this note's §3-§5. **Verdict: this note is not
implemented on its own.** The delivery-cost design note absorbs what is still current and is the
one the builder implements.

| Part | State on `main` at `ab4afaa` |
|---|---|
| §1 facts | Still true except the `orders.test.ts:83` skip (fixed, #18) and `subtotal_azn` (written since `24022d0`) |
| §2 `site_settings` typed columns | **Current** — the delivery-cost spec §7 reuses them |
| §3 `quoteDelivery` | Superseded: must also answer "no number at checkout" (spec §7) |
| §4 `displayed_total` + 409 | **Current**, narrowed to `subtotal − discount` (spec §4). §4.6 still needed: `POST /products/prices` returns `products.price` and the checkout calls `updateQty` only |
| §5 `NOT NULL DEFAULT 0` | Superseded: `delivery_fee_azn` is nullable, no default (spec §3, §9.1) |
| §6, §7 surfaces and invariant | **Current**; `CartDrawer.tsx:9` still holds `FREE_DELIVERY_THRESHOLD = 100` |
| §8 migrations | 1 done (`24022d0`); 2 superseded; 3 current |
| §9 commit 1 | Done (#18) |
