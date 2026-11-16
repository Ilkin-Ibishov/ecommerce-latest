# Audit Notes — fix/counter-sale-confirmation Round 1

**Date:** 2026-11-16  
**Branch:** `fix/counter-sale-confirmation`  
**Input:** `prompts/fix-counter-sale-confirmation-round-1.md`  

---

## 1. What Changed Per Item

### Item 1: A lost response leaves the cashier with a 409 (blocker)
- **File:** `artifacts/store/src/pages/admin/CounterPage.tsx`
- **Changes:**
  - Added `soldAtRef = useRef<string | null>(null)` to store and preserve the sale timestamp across retries.
  - Used `soldAtRef.current ??= new Date().toISOString()` in `complete()` when constructing the payload for `adminFetch(apiUrl("/admin/counter/sales"), ...)`.
  - Reset `soldAtRef.current = null` in the two places the attempt terminates: the `!res.ok` branch and the success path (next to `setSaleId(crypto.randomUUID())`). Did not reset in the `catch` block.
  - Removed `setPending(false)` from the `catch` block so that network failures leave the cart, discount, and payment method frozen and allow `handleOpenConfirm` to resend the exact same sale payload.
- **Commit:** `69a3787 fix(counter): freeze cart and reuse sold_at across network retries`

### Item 2: One change calculation, in whole qəpik, from the server's total
- **Files:**
  - `artifacts/store/src/components/admin/counter/counter-input.ts` (new file)
  - `artifacts/store/src/components/admin/counter/PaymentConfirmationModal.tsx`
  - `artifacts/store/src/pages/admin/CounterPage.tsx`
- **Changes:**
  - Created `counter-input.ts` with pure function `computeChange(tendered: string | number, total: number): { sufficient: boolean; change: number }`. Parses tendered with `Number`, handles non-finite or empty strings by returning `{ sufficient: false, change: 0 }`, and calculates change in integer qəpik (`Math.round(x * 100)`) returning AZN (`/ 100`).
  - Updated `CounterPage.tsx` live checkout calculations to use `computeChange(tenderedAmount, priced.total_amount)` for `hasValidCashTender` and `changeAmount`.
  - Updated `PaymentConfirmationModal.tsx` to derive `isSufficient` and `changeDue` from `computeChange(tenderedAmount, totalAmount)`.
  - Updated `CounterPage.tsx` completion handler to compute receipt change against the server total (`computeChange(tenderedAmount, Number(data.total_amount))`), passing `change: null` if `Number(data.total_amount)` differs from `priced.total_amount`.
- **Commit:** `ac78b2f fix(counter): compute change in whole qepik from server total`

### Item 3: The quantity field truncates and fires on no change
- **Files:**
  - `artifacts/store/src/components/admin/counter/counter-input.ts`
  - `artifacts/store/src/components/admin/counter/CartLines.tsx`
- **Changes:**
  - Added `parseQuantity(text: string): number | null` to `counter-input.ts` returning the number only when `Number(text)` is an integer between 1 and 9999 inclusive; returns `null` for non-integers, out-of-range numbers, and non-numeric inputs.
  - In `QuantityCell` (`CartLines.tsx`), updated `onChange` to invoke parent only when `parseQuantity` returns a number that differs from `quantity`.
  - Updated `commit()` in `QuantityCell` to invoke parent only when parsed number differs from `quantity`, and when `null` only reset input text to `String(quantity)` without firing parent `onChange`.
- **Commit:** `cd1e95c fix(counter): reject invalid quantities and avoid firing on no-op changes`

### Item 4: Tests for the two pure functions
- **File:** `artifacts/store/src/__tests__/counter-input.test.ts` (new file)
- **Changes:**
  - Added unit test suite covering `computeChange`:
    - `("20", 19)` -> `{ sufficient: true, change: 1 }`
    - `("19", 19)` -> `{ sufficient: true, change: 0 }`
    - `("18.99", 19)` -> `sufficient: false`
    - `("", 19)` and `("abc", 19)` -> `{ sufficient: false, change: 0 }`
    - Float edge case `("0.3", 0.1)` -> `{ sufficient: true, change: 0.2 }` without precision drift
    - Number arguments work identically to string arguments
  - Added unit test suite covering `parseQuantity`:
    - `"1"`, `"12"`, `"9999"` -> numbers `1`, `12`, `9999`
    - `"2.5"`, `""`, `"0"`, `"-1"`, `"abc"`, `"1e9"`, `"10000"` -> `null`
- **Commit:** `c3d390d test(counter): add unit tests for computeChange and parseQuantity`

### Item 5: Translations for the till
- **Files:**
  - `artifacts/store/src/lib/i18n/messages/az.ts`
  - `artifacts/store/src/lib/i18n/messages/ru.ts`
  - `artifacts/store/src/lib/i18n/messages/en.ts`
  - `artifacts/store/src/pages/admin/CounterPage.tsx`
  - `artifacts/store/src/pages/admin/CounterSalesPage.tsx`
  - `artifacts/store/src/components/admin/counter/CartLines.tsx`
  - `artifacts/store/src/components/admin/counter/CounterCheckoutPanel.tsx`
  - `artifacts/store/src/components/admin/counter/LookupBox.tsx`
  - `artifacts/store/src/components/admin/counter/PaymentConfirmationModal.tsx`
  - `artifacts/store/src/components/admin/counter/ReceiptModal.tsx`
- **Changes:**
  - Confirmed via search that `Admin.Counter` did not previously exist.
  - Added `Admin.Counter` dictionary section with 83 keys across all three languages (`az.ts`, `ru.ts`, `en.ts`). Kept Azerbaijani values identical to current UI literals and wrote natural Russian and English equivalents.
  - Replaced all user-visible strings, labels, placeholders, and aria-labels in the seven files with `t()` calls using `{param}` placeholders and `.replace` where dynamic values are interpolated.
  - Updated `ReceiptModal.tsx` to read `locale` from `useI18n()` and use it instead of hardcoded `"az-AZ"`, `"az"` in `lineTitle`, and `"az"` in store name lookup. Replaced static `PAYMENT` map with `t()` translations. Kept currency code `AZN`, `#`, `×`, `№`, and numbers as literals.
- **Commit:** `e829f39 fix(counter): add i18n translations across till UI and dictionaries`

### Item 6: Small defects in the same files
- **Files:**
  - `artifacts/store/src/pages/admin/CounterPage.tsx`
  - `artifacts/store/src/components/admin/counter/ReceiptModal.tsx`
  - `artifacts/store/src/components/admin/counter/PaymentConfirmationModal.tsx`
- **Changes:**
  - `CounterPage.tsx`: passed `disabled={pending || !!picker || showConfirm || !!completedReceipt}` to `LookupBox` to prevent blur refocusing from fighting open modals.
  - `ReceiptModal.tsx`: reset `sale` to `null` and `error` to `false` at the start of the effect; set `error` and cleared loading on fetch rejection or non-200 responses; rendered translated error message and close button on error; guarded render so a sale with `id !== saleId` is never rendered.
  - `ReceiptModal.tsx`: added `DialogDescription` with `className="sr-only"` containing translated description.
  - `PaymentConfirmationModal.tsx`: changed `<label>` to `<span id="payment-method-label">` and added `aria-labelledby="payment-method-label"` to the radio group div instead of `aria-label`.
- **Commit:** `b691013 fix(counter): fix lookup blur focus fight, receipt error state, dialog a11y`

### Item 7: File size and duplication
- **Files:**
  - `artifacts/store/src/components/admin/counter/PaymentConfirmationModal.tsx`
  - `artifacts/store/src/components/admin/counter/CounterCheckoutPanel.tsx`
  - `artifacts/store/src/components/admin/counter/types.ts`
  - `artifacts/store/src/pages/admin/CounterPage.tsx`
- **Changes:**
  - Exported `Outcome` type from `types.ts` and imported it in both `CounterPage.tsx` and `CounterCheckoutPanel.tsx`, removing duplicate declarations.
  - Removed unused `Link` import from `CounterCheckoutPanel.tsx`.
  - Refactored the three payment method buttons in `PaymentConfirmationModal.tsx` to iterate over a `PAYMENT_METHODS` array with `.map()`.
  - Reduced `PaymentConfirmationModal.tsx` from 218 lines down to 199 lines (under the 200-line house limit).
- **Commit:** `74b0a04 fix(counter): reduce modal size under 200 lines and deduplicate Outcome type`

---

## 2. Every Test Added

- New file `artifacts/store/src/__tests__/counter-input.test.ts` (8 tests):
  1. `counter-input > computeChange > computes change when tendered exceeds total`
  2. `counter-input > computeChange > computes zero change when exact amount tendered`
  3. `counter-input > computeChange > reports insufficient when tendered is less than total`
  4. `counter-input > computeChange > reports insufficient and zero change for empty or non-numeric input`
  5. `counter-input > computeChange > handles float cases accurately without precision errors`
  6. `counter-input > computeChange > accepts number arguments equivalent to strings`
  7. `counter-input > parseQuantity > parses valid positive integer quantities within bounds`
  8. `counter-input > parseQuantity > rejects invalid, empty, out-of-range, or non-integer inputs`

---

## 3. Blocked / Assumptions / Not Verified

- **Not verified:** Nothing here was run in a browser.
- **Not verified:** The integration (`api-integration`) and E2E tiers were not run locally; only the offline unit test and typecheck tiers were run.
- **Not verified:** A fractional `pack_quantity` in `LookupItem` still reaches the API through `addItem` in `CounterPage.tsx` and is rejected by backend validation there (`artifacts/api-server/src/routes/admin/counter-sales.ts`).
- **Blocked:** None.
- **Assumptions:** None.

---

## 4. Tests Deleted, Renamed or Weakened

None.

---

## 5. Command Output

### `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-counter-sale
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-counter-sale
> tsc --build

Scope: 5 of 11 workspace projects
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### `pnpm test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-counter-sale
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/fix-counter-sale

 ✓ |store-unit| src/lib/settings/theme-engine.property.test.ts (4 tests) 73ms
 ✓ |store-unit| src/__tests__/cart-validation.test.ts (25 tests) 163ms
 ✓ |store-unit| src/__tests__/admin-list.property.test.ts (7 tests) 86ms
 ✓ |store-unit| src/__tests__/heading-hierarchy.property.test.ts (8 tests) 67ms
 ✓ |store-unit| src/__tests__/image-proxy.property.test.ts (5 tests) 142ms
 ✓ |store-unit| src/__tests__/order-tracking.property.test.ts (6 tests) 259ms
 ✓ |store-unit| src/lib/settings/cms-rendering.property.test.ts (14 tests) 283ms
 ✓ |store-unit| src/__tests__/counter-pricing.test.ts (10 tests) 66ms
 ✓ |store-unit| src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 123ms
 ✓ |store-unit| src/__tests__/invariant-definer-grants.test.ts (5 tests) 1225ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals.test.ts (7 tests) 1450ms
 ✓ |store-unit| src/__tests__/translated-field.property.test.ts (3 tests) 78ms
 ✓ |store-unit| src/__tests__/brand-marquee.test.ts (8 tests) 316ms
 ✓ |store-unit| src/__tests__/i18n-consistency.test.ts (16 tests) 36ms
 ✓ |store-unit| src/lib/settings/storefront-rendering.property.test.ts (11 tests) 468ms
 ✓ |store-unit| src/__tests__/costing-engine-replay.property.test.ts (4 tests) 34ms
 ✓ |store-unit| src/__tests__/i18n-split.property.test.ts (2 tests) 47ms
 ✓ |store-unit| src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 22ms
 ✓ |store-unit| src/__tests__/allow-negative-stock.test.ts (9 tests) 24ms
 ✓ |store-unit| src/__tests__/admin-logic.test.ts (32 tests) 36ms
 ✓ |store-unit| src/__tests__/admin-components.property.test.ts (6 tests) 60ms
 ✓ |store-unit| src/__tests__/stocktake-variance.test.ts (24 tests) 30ms
 ✓ |store-unit| src/__tests__/invariant-counter-sale-payments.test.ts (10 tests) 2048ms
 ✓ |store-unit| src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 28ms
 ✓ |store-unit| src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 18ms
 ✓ |env-validation| tests/env-validation.test.ts (9 tests) 17ms
 ✓ |store-unit| src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 14ms
 ✓ |store-unit| src/lib/settings/context.test.ts (32 tests) 21ms
 ✓ |store-unit| src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 14ms
 ✓ |store-unit| src/__tests__/admin-components.test.ts (17 tests) 14ms
 ✓ |store-unit| src/__tests__/i18n-preservation.test.ts (36 tests) 12ms
 ✓ |store-unit| src/__tests__/barcode-pack-quantity.test.ts (6 tests) 12ms
 ✓ |store-unit| src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 13ms
 ✓ |store-unit| src/__tests__/image-proxy.unit.test.ts (25 tests) 14ms
 ✓ |store-unit| src/__tests__/m2c-reservations-order.test.ts (3 tests) 12ms
 ✓ |store-unit| src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 8ms
 ✓ |store-unit| src/__tests__/m4-null-availability.unit.test.ts (15 tests) 11ms
 ✓ |store-unit| src/__tests__/receiving-cost-integrity.test.ts (5 tests) 12ms
 ✓ |store-unit| src/__tests__/storefront-ux.property.test.ts (25 tests) 2826ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  1754ms
   ✓ Property 3: Quick View addItem uses correct variant data > variant selection never changes the product_id or image  395ms
 ✓ |store-unit| src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 11ms
 ✓ |store-unit| src/lib/settings/theme-engine.test.ts (15 tests) 13ms
 ✓ |store-unit| src/__tests__/blind-counting-security.test.ts (4 tests) 7ms
 ✓ |store-unit| src/__tests__/m4-stock-signals-ui.test.ts (4 tests) 10ms
 ✓ |store-unit| src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 11ms
 ✓ |store-unit| src/__tests__/staff-cost-reachability.test.ts (6 tests) 10ms
 ✓ |store-unit| src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 8ms
 ✓ |store-unit| src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 11ms
 ✓ |store-unit| src/lib/settings/default-rendering.test.ts (17 tests) 12ms
 ✓ |store-unit| src/__tests__/m4-stock-signals.unit.test.ts (15 tests) 10ms
 ✓ |store-unit| src/pages/admin/SettingsPage.test.ts (22 tests) 10ms
 ✓ |store-unit| src/__tests__/queries.test.ts (14 tests) 15ms
 ✓ |store-unit| src/__tests__/admin-i18n.property.test.ts (2 tests) 38ms
 ✓ |store-unit| src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 11ms
 ✓ |store-unit| src/__tests__/fixtures.test.ts (7 tests) 10ms
 ✓ |store-unit| src/__tests__/stocktake-reconciliation.test.ts (4 tests) 8ms
 ✓ |store-unit| src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 9ms
 ✓ |store-unit| src/__tests__/m2c-reservations-suite.test.ts (7 tests) 10ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals-schema.test.ts (4 tests) 10ms
 ✓ |store-unit| src/__tests__/counter-input.test.ts (8 tests) 9ms
 ✓ |store-unit| src/__tests__/unit-cost-privacy.test.ts (3 tests) 8ms
 ✓ |store-unit| src/__tests__/adjustment-role-guards.test.ts (4 tests) 7ms
 ✓ |store-unit| src/components/admin/ImageCandidateGrid.test.ts (9 tests) 9ms
 ✓ |store-unit| src/__tests__/margin-report-granularity.test.ts (3 tests) 6ms
 ✓ |store-unit| src/__tests__/stock-adjust-race.test.ts (2 tests) 7ms
 ✓ |store-unit| src/__tests__/inventory-auth.test.ts (4 tests) 6ms
 ✓ |store-unit| src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 528ms
   ✓ SEC-003 CouponsPage reads the list via adminFetch (Property 3 / Property 8 [3.9]) > renders the page heading  346ms
 ✓ |store-unit| src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 599ms
   ✓ SEC-008 LoginModal name step re-routes to /profile (Property 1) > renders the phone step heading when open  359ms
 ✓ |store-unit| src/__tests__/checkout-form-security.test.ts (1 test) 280ms

 Test Files  68 passed (68)
      Tests  749 passed (749)
   Start at  10:50:46
   Duration  16.33s (transform 8.82s, setup 0ms, collect 30.82s, tests 11.86s, environment 17.45s, prepare 24.44s)
```

### `pnpm run audit:invariants`
```
> workspace@0.0.0 audit:invariants C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-counter-sale
> node scripts/audit/check-invariants.mjs

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

All invariant checks passed.
```
