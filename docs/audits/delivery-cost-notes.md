# Delivery Cost at Confirmation — Build Round 1 Audit Notes

## Commits

1. `256de1b feat(schema): delivery fee columns, trigger, function and site settings`
   - `supabase/migrations/20261118140000_orders_delivery_fee.sql`: Added nullable `delivery_fee_azn numeric(10,2) CHECK (>= 0)` to `orders` and created trigger `trg_orders_compute_total` computing `total_azn = subtotal_azn - discount_azn + delivery_fee_azn`.
   - `supabase/migrations/20261118140100_set_order_delivery_fee.sql`: Created RPC `set_order_delivery_fee` (`ST050` when order missing, `ST051` when closed status `delivered`, `refused_at_delivery`, `cancelled`; updates `delivery_fee_azn` and creates `audit_log` row with action `set_delivery_fee`; `REVOKE ALL FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE TO service_role`).
   - `supabase/migrations/20261118140200_orders_fee_before_dispatch.sql`: Added valid `CHECK (status NOT IN ('courier_assigned','shipped','delivered') OR delivery_fee_azn IS NOT NULL)` on `orders`.
   - `supabase/migrations/20261118140300_site_settings_delivery.sql`: Added nullable `delivery_fee_azn` and `free_delivery_threshold_azn` to `site_settings`; deleted unread `store_settings` row `free_delivery_threshold`.
   - `artifacts/supabase-types/src/database.types.ts`: Generator-style typing for new columns and RPC function.

2. `9f0775e feat(pricing): add @workspace/order-pricing package and offline tests`
   - Created package `lib/order-pricing/` (`package.json`, `tsconfig.json`, `src/index.ts`).
   - Implemented `quoteDelivery`, `goodsTotal`, and `orderTotal` using whole qəpik integer math.
   - Wired into workspace dependencies and tsconfig paths.
   - Added offline unit tests in `artifacts/store/src/__tests__/order-pricing.test.ts` (8 tests).

3. `6dc6bbe feat(orders): enforce displayed total check at order creation and setPrice in cart`
   - `artifacts/api-server/src/routes/admin/schemas.ts`: Updated `OrderBodySchema` with required `displayed_total` and optional `displayed_delivery_fee`.
   - `artifacts/api-server/src/routes/orders.ts`: Reads `site_settings`, computes `quoteDelivery`, verifies `displayed_total` against `goodsTotal` before `decrementOrderStock`, verifies `displayed_delivery_fee`, throws 409 `total_changed` with per-product prices, inserts `delivery_fee_azn`, returns `total` and `delivery_fee` in 201 response.
   - `artifacts/api-server/src/routes/products.ts`: `POST /products/prices` returns default variant price.
   - `artifacts/store/src/lib/cart/context.tsx`: Added `setPrice` action to cart.
   - `artifacts/store/src/pages/storefront/CheckoutPage.tsx`: Connected `setPrice` on price changes.

4. `24991e2 feat(admin): order confirmation delivery fee recording and whatsapp messages`
   - `artifacts/api-server/src/routes/admin/orders.ts`: `PATCH /admin/orders/:id/status` executes `set_order_delivery_fee` (`ST050` -> 404, `ST051` -> 409), refuses dispatch statuses when fee is NULL (409 `delivery_fee_required` and maps DB `23514`), handles notifications.
   - `artifacts/api-server/src/lib/notifications.ts`: Added `delivery_fee_set` to `NotifType` and dispatch branch in `queueNotification`.
   - `artifacts/api-server/src/lib/whatsapp.ts`: Added `sendWhatsAppDeliveryFeeSet`, updated `sendWhatsAppOrderConfirmed` and `sendWhatsAppStatusUpdate` with spec §13 verbatim Azerbaijani strings.

5. `56505b7 feat(store): storefront and admin delivery fee surfaces, settings tab and readers`
   - `artifacts/store/src/pages/admin/settings/DeliveryTab.tsx`: Created Delivery tab component with two number inputs (`step="0.01" min="0"`) and live summary text.
   - `artifacts/store/src/pages/admin/SettingsPage.tsx`: Wired `DeliveryTab` and tab button.
   - `artifacts/api-server/src/routes/site-settings.ts`: Added fields to `VALID_FIELDS`, `DEFAULT_SETTINGS`, and `PATCH /site-settings`.
   - `artifacts/store/src/lib/settings/context.tsx`: Added fields to `SiteSettings` and `DEFAULT_SETTINGS`.
   - `artifacts/store/src/pages/admin/OrderDetailPage.tsx`: Added delivery fee input, "Not set" text, and fee saving.
   - `artifacts/store/src/pages/admin/OrdersPage.tsx`: Added "fee not set" badge when `delivery_fee_azn === null && status !== "pending"`.
   - `artifacts/store/src/lib/queries/orders.ts`: Added `delivery_fee_azn` to `ORDERS_SELECT` and `OrderRow`.
   - `artifacts/store/src/pages/admin/DashboardPage.tsx`: Cards and chart select `subtotal_azn, discount_azn` and compute revenue as `subtotal_azn - discount_azn`.
   - `artifacts/api-server/src/routes/store-metrics.ts`: Revenue calculation uses `subtotal_azn - discount_azn`.
   - `artifacts/api-server/src/routes/admin/orders.ts`: CSV export adds "Delivery (AZN)" column (empty for NULL, 0.00 for 0).
   - `artifacts/api-server/src/routes/orders.ts`: `GET /profile/orders/:id` selects and returns `delivery_fee_azn`.
   - `artifacts/store/src/pages/storefront/OrderTrackingPage.tsx`: Added delivery fee display line.
   - `artifacts/store/src/pages/storefront/PoliciesPage.tsx`: Deleted flat-rate delivery point in all three languages.
   - `artifacts/store/src/components/storefront/CartDrawer.tsx`: Removed `FREE_DELIVERY_THRESHOLD = 100`, reads threshold from `useSettings()`, hides progress bar when no threshold configured.
   - `artifacts/store/src/components/storefront/TrustBadges.tsx`: Hides free delivery badge when no threshold configured; formats subtitle with `{amount}`.
   - `artifacts/store/src/components/storefront/ProductDetail.tsx`: Hides free delivery line when no threshold configured; formats with `{amount}`.
   - `artifacts/store/src/pages/storefront/CheckoutPage.tsx`: Spec §13 strings verbatim under `Checkout.*`, quotes delivery, handles quote null ("Təsdiq zamanı bildirilir", "Məhsulların məbləği", explaining sentence), sends `displayed_total` and `displayed_delivery_fee`.
   - `artifacts/store/src/lib/i18n/messages/` (`az.ts`, `ru.ts`, `en.ts`): Added missing keys under `Checkout`, `Admin.Orders`, `Admin.OrderDetail`, `Admin.Settings`, `OrderTracking`; updated `freeDeliverySubtitle` and `freeDeliveryOver` with `{amount}` placeholder and zero digits. Preserved mixed CRLF/LF line endings.

6. `31ac65f feat(audit): delivery cost architectural invariants`
   - Added 5 invariants to `scripts/audit/check-invariants.mjs`:
     1. `delivery-fee-azn-writers`: `delivery_fee_azn` on orders written only by `set_order_delivery_fee` and order insert in `routes/orders.ts`.
     2. `total-azn-writers`: `total_azn` on orders written by no code under `artifacts/` except order insert.
     3. `no-coalesce-delivery-fee`: No `COALESCE(delivery_fee_azn` and no `delivery_fee_azn ?? 0` under `artifacts/` or in migrations.
     4. `delivery-fee-single-source`: No numeric literal assigned to a delivery identifier under `store/src`; no digit under a `deliver` dictionary key (excluding `estimatedDelivery`); `quoteDelivery` and `orderTotal` defined only in `lib/order-pricing`.
     5. `orders-status-writers`: `orders.status` written only by `routes/admin/orders.ts` and cancel-restock path.

7. `1698dae test(delivery): integration, e2e, and i18n consistency tests for delivery cost`
   - `artifacts/api-server/tests/serial/delivery-cost.serial.test.ts`: Integration suite implementing all 10 scenarios from spec §11.
   - `artifacts/store/tests/e2e/delivery-cost-checkout.spec.ts`: E2E suite verifying checkout summary with null quote and stored `subtotal_azn`.
   - `artifacts/store/src/__tests__/i18n-consistency.test.ts`: Replaced lines 82-97 with assertion that no string under a `deliver` key holds a digit.
   - `artifacts/store/src/__tests__/checkout-form-security.test.ts`: Added mock for `useSettings`.

---

## Blocked / Assumptions / Not verified

### Blocked
None.

### Assumptions
- `AnnouncementBar` was kept unchanged per note §8 and prompt item 5 (owner's open question).
- Staff recording the fee (spec §5) is pending opening orders to staff (design note §11).

### Not verified
- Integration tests in `artifacts/api-server/tests/serial/delivery-cost.serial.test.ts` and E2E tests in `artifacts/store/tests/e2e/delivery-cost-checkout.spec.ts` were **NOT run locally** (CI only). They require live Supabase credentials and a running dev server in CI (`.github/workflows/test.yml`). Do not claim they passed.
- No migrations were applied to any database and no SQL was run directly against Supabase.
- WhatsApp provider accepting the longer message was not verified against live Meta API.
- `modern-web-guidance` tool was not preinstalled locally and could not run offline via `npx --no-install`.

---

## Tests Deleted, Renamed, Moved, Weakened, or Replaced

- **Deleted**: None.
- **Renamed**: None.
- **Moved**: None.
- **Weakened**: None.
- **Replaced**:
  - `artifacts/store/src/__tests__/i18n-consistency.test.ts:82-97`: Replaced case `all freeDelivery references mention 100 AZN consistently` with `no string under a key containing deliver holds a digit` (authorized by spec §7 and prompt item 7).
- **Added**:
  - `artifacts/store/src/__tests__/order-pricing.test.ts` (8 unit tests)
  - `artifacts/api-server/tests/serial/delivery-cost.serial.test.ts` (10 serial integration tests covering spec §11)
  - `artifacts/store/tests/e2e/delivery-cost-checkout.spec.ts` (2 E2E tests)

---

## Command Outputs

### 1. `pnpm run typecheck`

```
> workspace@0.0.0 typecheck C:\Users\user\AppData\Local\Temp\claude\187f700e7e3cbad0\7249f150-dfbc-4162-be46-7de64e502a19\scratchpad\wt-delivery
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\AppData\Local\Temp\claude\187f700e7e3cbad0\7249f150-dfbc-4162-be46-7de64e502a19\scratchpad\wt-delivery
> tsc --build

Scope: 5 of 12 workspace projects
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### 2. `pnpm run audit:invariants:strict`

```
> workspace@0.0.0 audit:invariants:strict C:\Users\user\AppData\Local\Temp\claude\187f700e7e3cbad0\7249f150-dfbc-4162-be46-7de64e502a19\scratchpad\wt-delivery
> node scripts/audit/check-invariants.mjs --strict

ok    ledger-only-stock-writes         0 total, 0 new
ok    rls-on-new-tables                0 total, 0 new
ok    no-has-variants-flag             0 total, 0 new
ok    no-customer-industry-naming      0 total, 0 new
ok    reservations-are-not-movements   0 total, 0 new
ok    on-hand-repair-setting-isolation 0 total, 0 new
ok    no-direct-variant-costs-writes   0 total, 0 new
ok    no-cost-column-on-staff-tables   0 total, 0 new
ok    no-private-columns-on-anon-grants 0 total, 0 new
ok    no-expected-quantity-on-staff-endpoints 0 total, 0 new
ok    security-definer-service-role-privileges 0 total, 0 new
ok    no-client-insert-policy-on-stock-movements 0 total, 0 new
ok    stocktake-mutations-check-draft-status 0 total, 0 new
ok    no-on-hand-reads-on-storefront   0 total, 0 new
ok    no-sensitive-columns-in-exposed-views 0 total, 0 new
ok    no-client-writes-on-counter-sale-payments 0 total, 0 new
ok    post-counter-sale-writes-payments 0 total, 0 new
ok    no-non-tracked-variant-movements 0 total, 0 new
ok    signals-have-one-derivation      0 total, 0 new
ok    no-undispatched-notification-type 0 total, 0 new
ok    i18n-keys-exist-in-dictionaries  0 total, 0 new
ok    no-auth-metadata-role-reads      0 total, 0 new
ok    role-written-only-by-users-route 0 total, 0 new
ok    delivery-fee-azn-writers         0 total, 0 new
ok    total-azn-writers                0 total, 0 new
ok    no-coalesce-delivery-fee         0 total, 0 new
ok    delivery-fee-single-source       0 total, 0 new
ok    orders-status-writers            0 total, 0 new

All invariant checks passed.
```

### 3. `pnpm test:unit`

```
> workspace@0.0.0 test:unit C:\Users\user\AppData\Local\Temp\claude\187f700e7e3cbad0\7249f150-dfbc-4162-be46-7de64e502a19\scratchpad\wt-delivery
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/AppData/Local/Temp/claude/187f700e7e3cbad0/7249f150-dfbc-4162-be46-7de64e502a19/scratchpad/wt-delivery

 Test Files  75 passed (75)
      Tests  787 passed (787)
   Start at  23:02:57
   Duration  53.97s (transform 18.75s, setup 0ms, collect 74.35s, tests 62.30s, environment 86.74s, prepare 139.57s)
```
