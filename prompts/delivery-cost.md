# Delivery cost agreed at confirmation — build round 1

Read `AGENTS.md`, `artifacts/api-server/AGENTS.md`, `artifacts/store/AGENTS.md`, `supabase/AGENTS.md`,
the spec `docs/tasks/delivery-cost-at-confirmation.md` and the approved design note
`docs/design-notes/delivery-cost-at-confirmation.md`. **The note is the build plan; where it deviates
from the spec it says why, and the note wins.** `docs/design-notes/delivery-fee.md` §12 says which of
its parts still hold; read §1, §4 and §7 of it for detail the new note points at.

Branch `phase/delivery-cost`; it is checked out. Never commit to `main`. Commit locally; do not push.
**Do not touch any Supabase project and do not run SQL** — the architect applies migrations.
**Do not edit any existing file under `supabase/migrations/`.**

Another builder is working on M4b (`AdminLayout.tsx`, `NotificationCenterPage.tsx`, `routes/admin/inbox.ts`,
`lib/inbox.ts`). **Do not touch those files.** You both add keys to the three dictionaries: add yours under the
existing namespace of the page you are changing (e.g. `Checkout.*`, `Admin.OrderDetail.*`), and preserve each dictionary file's existing line endings exactly (they mix
CRLF/LF; `git diff --stat` must show only your lines).

If an instruction turns out wrong against the code, **stop on that item**, record it under *Blocked*
in the notes file, and go on. Never invent a column, route, key or setting. Columns the architect
confirmed on the test project (2026-11-18): `orders.subtotal_azn`, `discount_azn` (default 0),
`total_azn` — all `numeric NOT NULL`; `orders.status` is the enum `order_status`; the test project
holds 0 orders.

One commit per numbered item, message `<type>(<scope>): <what changed>`.

## 1. Migrations (note §2, §3, §4, §5)
Four files, one concern each, timestamps `20261118140000` … `20261118140300`:
1. `_orders_delivery_fee.sql` — the column and the `orders_compute_total` trigger, exactly note §2.
2. `_set_order_delivery_fee.sql` — note §3 (`ST050` no row, `ST051` closed status; same fee writes
   nothing; update + `audit_log` line `set_delivery_fee` with `{old_fee, new_fee, old_total, new_total}`
   in one transaction; not `SECURITY DEFINER`; `SET search_path = ''`; `REVOKE ALL … FROM PUBLIC, anon,
   authenticated`; `GRANT EXECUTE … TO service_role`). `git grep ST05` first — must be unused.
3. `_orders_fee_before_dispatch.sql` — the **valid** `CHECK` of note §4.
4. `_site_settings_delivery.sql` — note §5: two nullable columns with their `CHECK`s, both `NULL`, and
   `DELETE FROM public.store_settings WHERE key = 'free_delivery_threshold'`.
Then `artifacts/supabase-types/src/database.types.ts`: the new columns and the function, generator format.

## 2. `lib/order-pricing`
New package `@workspace/order-pricing`, built exactly like `lib/counter-pricing` (package.json,
tsconfig, workspace wiring, how the api-server and store import it). `quoteDelivery(goodsSubtotal,
settings)` per note §5 (`null` when the setting is `NULL`; fee; 0 at/above the threshold; coupon
ignored) and `goodsTotal(subtotal, discount)`, qəpik integers throughout. Offline unit tests in the
store-unit project (or the package's own, if counter-pricing has its own — follow it): `null`; flat;
threshold below/at/above; 99.99/100.00.

## 3. Order creation (note §5)
`routes/orders.ts` and `OrderBodySchema` (`routes/admin/schemas.ts`): required `displayed_total`
compared with `subtotal − discount` in qəpik **before** `decrementOrderStock`; optional
`displayed_delivery_fee` compared with the quote when it is a number; mismatch → `409
{ error: "total_changed", subtotal, discount, delivery_fee, total, prices }`. Insert
`delivery_fee_azn` = the quote (or `null`). Return `total`, `delivery_fee` in the 201.
Same commit: `POST /products/prices` returns the default variant's price (what the order route
charges), and the checkout refresh sets the price through a new cart action `setPrice`, not only the
quantity (delivery-fee note §4.6).

## 4. Confirmation route and messages (note §6)
`PATCH /admin/orders/:id/status` per note §6, steps 1–4 exactly (body `{ status?, delivery_fee_azn? }`,
fee string `^\d{1,8}(\.\d{1,2})?$`; `ST050` → 404 `not_found`; `ST051` → 409 `fee_closed`; dispatch
statuses while fee `NULL` → 409 `delivery_fee_required`, and DB `23514` maps to the same). Keep
`requireAdmin`. WhatsApp texts **verbatim from spec §13**; the new notification type
`delivery_fee_set` added to `NotifType` and dispatched (invariant `no-undispatched-notification-type`).

## 5. Storefront and admin screens (note §5, §7)
Checkout (`CheckoutPage.tsx` rows `:299,:328-332`): spec §13 strings verbatim under `Checkout.*`;
confirmation screen shows the server's figures. Remove every hard-coded 100 (`CartDrawer.tsx:9`
`FREE_DELIVERY_THRESHOLD`, `freeDeliverySubtitle`, `freeDeliveryOver`): the threshold comes from
`site_settings`; with none, these surfaces say nothing about free delivery. Delete the
`PoliciesPage` flat-rate sentence in all three languages. Leave `AnnouncementBar` exactly as it is
(owner's open question). Admin: Settings gets a Delivery tab in its own file under
`pages/admin/settings/` (two `<input type="number" step="0.01" min="0">`, empty = `null`), and
`PATCH /site-settings` `VALID_FIELDS` validates both. Readers per note §7's table, including the
`OrderDetailPage` fee input and the `OrdersPage` "fee not set" badge. Run the
`modern-web-guidance` `search` before frontend code if that tool is available to you.

## 6. Invariants (note §9)
All five, in `scripts/audit/check-invariants.mjs`, passing on your tree.

## 7. Tests
- Integration in `artifacts/api-server/tests/serial/` (you cannot run them): the spec §11 list, all of
  it. Create users with `db.auth.admin.createUser` (`users.id` references `auth.users`; see
  `tests/serial/staff-provisioning.test.ts` for the pattern) and orders with `subtotal_azn`,
  `discount_azn`, `total_azn`. Read your own rows by id — the test project exceeds 1000 rows in
  several tables; never scan an unfiltered list.
- Replace the `i18n-consistency.test.ts:82-97` case as the spec authorises (no digit under a
  `deliver` key) — the only test you may replace; name it in the notes.
- E2E: a checkout whose summary shows no total it cannot support, and whose stored `subtotal_azn`
  equals the figure the page showed. Use the existing admin-auth helpers' pattern if a session is needed.
- Never delete, rename or `.skip()` any other test.

## Definition of done
- `pnpm run typecheck`, `pnpm run audit:invariants:strict`, `pnpm test:unit` pass.
- `docs/audits/delivery-cost-notes.md`: what each commit changed; **Blocked / Assumptions / Not
  verified**; every test added, replaced or changed by name; the **real output** of the three
  commands, pasted.
- State plainly that integration and E2E were **not run** (CI only). Do not claim they passed.
