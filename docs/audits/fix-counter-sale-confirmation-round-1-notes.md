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

---

# Audit Notes — fix/counter-sale-confirmation Round 2

**Date:** 2026-11-16  
**Branch:** `fix/counter-sale-confirmation`  
**Input:** `prompts/fix-counter-sale-confirmation-round-2.md`  

---

## 1. What Changed Per Item

### Item 1: A 5xx after the sale was committed still ends in a 409 loop
- **File:** `artifacts/store/src/pages/admin/CounterPage.tsx`
- **Changes:**
  - In `complete()`, added `.catch(() => ({}))` to `res.json()` to safely handle non-JSON responses.
  - When `res.status >= 500`: modal is closed (`setShowConfirm(false)`), error outcome is set (`setOutcome({ kind: "error", text: t("Admin.Counter.networkError") })`), `pending` remains `true`, and `soldAtRef` is not reset so the existing resend button can replay the identical payload.
  - When `data.code === "ST020"`: modal is closed, translated message `t("Admin.Counter.alreadyRecorded")` is displayed as error outcome, and a fresh attempt is initiated (`setSaleId(crypto.randomUUID())`, `soldAtRef.current = null`, `setPending(false)`), keeping the cart lines intact.
  - Other 4xx errors continue to unfreeze till and reset `soldAtRef`.
- **Commit:** `baa8e6c fix(counter): handle 5xx retry and ST020 duplicate sale code`

### Item 2: Leaving the page with an unknown outcome
- **File:** `artifacts/store/src/pages/admin/CounterPage.tsx`
- **Changes:**
  - Added an effect that attaches a `beforeunload` listener calling `e.preventDefault()` whenever `pending` is `true`, and removes the listener on cleanup / when `pending` becomes `false`.
- **Commit:** `3a2f6b9 fix(counter): add beforeunload warning when counter sale is pending`

### Item 3: A late lookup answer changes a frozen cart
- **File:** `artifacts/store/src/pages/admin/CounterPage.tsx`
- **Changes:**
  - Added early return `if (pending || showConfirm) return;` at the top of `addItem`.
  - Added early return `if (pending || showConfirm) return;` in the `onResults` callback before resolving single item or setting picker.
- **Commit:** `da72c54 fix(counter): ignore late search lookup results while cart is pending or confirm dialog open`

### Item 4: The lookup box steals focus from the quantity and tender fields
- **File:** `artifacts/store/src/components/admin/counter/LookupBox.tsx`
- **Changes:**
  - Updated `onBlur` to inspect `e.relatedTarget`. If `disabled` is true or `next` is an instance of `HTMLInputElement`, `HTMLTextAreaElement`, or `HTMLSelectElement`, refocusing is skipped. Otherwise, refocuses after 0 ms as before.
- **Commit:** `43746d1 fix(counter): prevent lookup box blur from stealing focus from form inputs`

### Item 5: Quantity field: a prefix is committed while typing; "+" has no upper bound
- **File:** `artifacts/store/src/components/admin/counter/CartLines.tsx`
- **Changes:**
  - In `QuantityCell`, updated `onChange` to only update local input state (`setVal(e.target.value)`) without calling parent `onChange` on intermediate keystrokes. Parent is called exclusively via `commit()` on blur and Enter keydown.
  - In `CartLines`, disabled the "+" button when `line.quantity >= 9999` (`disabled={locked || line.quantity >= 9999}`).
- **Commit:** `8ec5022 fix(counter): commit quantity only on blur or enter and cap increase at 9999`

### Item 6: False "owner must check stock" warning on non-tracked items
- **Files:**
  - `artifacts/store/src/components/admin/counter/CartLines.tsx`
  - `artifacts/store/src/pages/admin/CounterPage.tsx`
- **Changes:**
  - In `CartLines.tsx`, updated `overOnHand` condition to `line.available !== null && total > line.on_hand`, preventing false warnings on non-tracked items whose `available` is `null` and `on_hand` is `0`.
  - In `CounterPage.tsx` (`addBundle`), updated line mapping to assign `available: l.track_stock === false ? null : l.on_hand`.
- **Commit:** `3b7bf64 fix(counter): skip low stock warning for non-tracked inventory items`

### Item 7: Receipt modal: out-of-order answers, settings failure, long receipts
- **File:** `artifacts/store/src/components/admin/counter/ReceiptModal.tsx`
- **Changes:**
  - Added `let cancelled = false;` at the start of `useEffect` and `return () => { cancelled = true; };` cleanup; ignored resolves/rejects in `.then` and `.catch` when `cancelled`.
  - Added `.catch(() => null)` to `fetch(apiUrl("/site-settings"))` so network or endpoint failures for site settings do not cause receipt loading to reject into an error state.
  - Added `max-h-[90vh] overflow-y-auto` to `DialogContent` to ensure long receipts remain accessible and scrollable.
  - Kept component under the 200-line house limit (199 lines).
- **Commit:** `fb2565f fix(counter): handle receipt cancellation, site-settings fallback, and scroll overflow`

### Item 8: Translations and the E2E spec
- **Files:**
  - `artifacts/store/src/pages/admin/CounterSalesPage.tsx`
  - `artifacts/store/src/lib/i18n/messages/az.ts`
  - `artifacts/store/src/lib/i18n/messages/ru.ts`
  - `artifacts/store/src/lib/i18n/messages/en.ts`
  - `artifacts/store/tests/e2e/counter-sale.spec.ts`
- **Changes:**
  - In `CounterSalesPage.tsx`, updated void action button to use `t("Admin.Counter.voidSale")` instead of `cancel`.
  - Added `Admin.Counter.voidSale` across `az.ts` ("Ləğv et"), `ru.ts` ("Аннулировать"), and `en.ts` ("Void").
  - Removed unused key `Admin.Counter.available` from `az.ts`, `ru.ts`, and `en.ts`.
  - Added `Admin.Counter.alreadyRecorded` across `az.ts` ("Bu satış artıq qeyd olunub. Satışlar siyahısını yoxlayın."), `ru.ts` ("Эта продажа уже записана. Проверьте список продаж."), and `en.ts` ("This sale has already been recorded. Check the sales list.").
  - In `artifacts/store/tests/e2e/counter-sale.spec.ts`:
    - Updated line 71 assertion to expect input value on spinbutton role: `await expect(cartLines.first().getByRole("spinbutton")).toHaveValue("2");`.
    - Updated checkout flow to handle confirmation dialog: clicking "Tamamla", filling `#tendered-amount-modal` with `"10"`, clicking "Təsdiqlə və Satışı Tamamla", asserting in-page receipt `#inpage-receipt` visibility and text `"8.00"`, clicking "Yeni Satış" to dismiss receipt modal, and asserting the status text.
    - Deleted obsolete "Qəbz" link navigation steps (lines 103-106).
- **Commit:** `33bdf78 fix(counter): update void sale translation and align E2E spec with modal flow`

---

## 2. Tests Added, Changed, Deleted or Weakened

### Tests Added
None.

### Tests Changed
- `artifacts/store/tests/e2e/counter-sale.spec.ts`:
  - Cart line quantity assertion changed from text content on `span.tabular-nums` to `spinbutton` input value assertion (`.toHaveValue("2")`) reflecting `<QuantityCell>` input structure.
  - Payment checkout flow updated to interact with `PaymentConfirmationModal` (filling `#tendered-amount-modal`, confirming via "Təsdiqlə və Satışı Tamamla") and assert the newly displayed `#inpage-receipt` before closing via "Yeni Satış".
  - Obsolete "Qəbz" link navigation step at end of flow was removed in favor of the in-page receipt modal assertion.
  - All database state assertions remained unchanged.

### Tests Deleted or Weakened
None.

---

## 3. Blocked / Assumptions / Not Verified

- **Not verified:** Nothing here was run in a browser (in particular: Item 4 `LookupBox` focus behavior with `e.relatedTarget` across browser rendering engines, and Item 7 `ReceiptModal` vertical scrolling behavior and print CSS).
- **Not verified:** The E2E test tier (`counter-sale.spec.ts`) and integration tier (`api-integration`) were not run locally; only the offline unit test and typecheck tiers were executed.
- **Blocked:** None.
- **Assumptions:** None.

---

## 4. Command Output

### `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-counter-sale
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-counter-sale
> tsc --build

Scope: 5 of 11 workspace projects
artifacts/mockup-sandbox typecheck$ tsc -p tsconfig.json --noEmit
scripts typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck$ tsc -p tsconfig.json --noEmit
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### `pnpm test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-counter-sale
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/fix-counter-sale

 ✓ |store-unit| src/__tests__/heading-hierarchy.property.test.ts (8 tests) 131ms
 ✓ |store-unit| src/__tests__/cart-validation.test.ts (25 tests) 397ms
 ✓ |store-unit| src/__tests__/order-tracking.property.test.ts (6 tests) 909ms
   ✓ Feature: order-tracking-timeline, Property 5: All order items are displayed with required fields > all items have title, quantity, and correctly computed line_total, and row count equals array length  394ms
   ✓ Feature: order-tracking-timeline, Property 7: Date formatting respects active locale > formatted date uses correct locale identifier for any timestamp and locale  338ms
 ✓ |store-unit| src/lib/settings/cms-rendering.property.test.ts (14 tests) 862ms
 ✓ |store-unit| src/lib/settings/theme-engine.property.test.ts (4 tests) 259ms
 ✓ |store-unit| src/__tests__/translated-field.property.test.ts (3 tests) 200ms
 ✓ |store-unit| src/__tests__/counter-pricing.test.ts (10 tests) 362ms
 ✓ |store-unit| src/__tests__/image-proxy.property.test.ts (5 tests) 406ms
 ✓ |store-unit| src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 460ms
 ✓ |store-unit| src/__tests__/invariant-definer-grants.test.ts (5 tests) 3805ms
   ✓ security-definer-service-role-privileges > fails when only public is revoked (anon/authenticated keep Supabase's default grant)  792ms
   ✓ security-definer-service-role-privileges > fails when a client role is granted explicitly  654ms
   ✓ security-definer-service-role-privileges > passes when a later migration closes the grant  697ms
   ✓ no-client-insert-policy-on-stock-movements > fails while a client INSERT policy is live  676ms
   ✓ no-client-insert-policy-on-stock-movements > passes once a later migration drops it  977ms
 ✓ |store-unit| src/__tests__/brand-marquee.test.ts (8 tests) 1328ms
   ✓ Property 9: Marquee Rendering Correctness > each brand link href uses encodeURIComponent on brand name with correct locale prefix  353ms
   ✓ Property 9: Marquee Rendering Correctness > each brand img alt text equals the brand name  454ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals.test.ts (7 tests) 4689ms
   ✓ signals-have-one-derivation invariant > fails when a duplicate signals file exists in lib/  593ms
   ✓ signals-have-one-derivation invariant > fails when inventory-signals.ts has an empty catch block  716ms
   ✓ signals-have-one-derivation invariant > passes when routes handle errors without empty catch and no lib duplicate exists  867ms
   ✓ no-undispatched-notification-type invariant > fails when NotifType contains an unhandled type  690ms
   ✓ no-undispatched-notification-type invariant > passes when all NotifType members have dispatch branches  384ms
   ✓ no-non-tracked-variant-movements invariant > fails when M4 void_counter_sale does not filter track_stock = true  956ms
   ✓ no-non-tracked-variant-movements invariant > passes when M4 migrations properly guard and filter track_stock  479ms
 ✓ |store-unit| src/lib/settings/storefront-rendering.property.test.ts (11 tests) 1843ms
   ✓ Feature: white-label-customization, Property 18: Navigation links show only qualifying pages in sort order > header navigation includes exactly published pages with show_in_header=true, sorted by sort_order ascending  764ms
 ✓ |store-unit| src/__tests__/admin-list.property.test.ts (7 tests) 450ms
 ✓ |store-unit| src/__tests__/i18n-split.property.test.ts (2 tests) 183ms
 ✓ |store-unit| src/__tests__/stocktake-variance.test.ts (24 tests) 164ms
 ✓ |store-unit| src/__tests__/admin-components.property.test.ts (6 tests) 401ms
 ✓ |store-unit| src/__tests__/invariant-counter-sale-payments.test.ts (10 tests) 7106ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when a migration grants INSERT on counter_sale_payments to authenticated  749ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when a migration grants ALL on counter_sale_payments to anon  575ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when an RLS policy grants client INSERT on counter_sale_payments  506ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when GRANT ALL ON ALL TABLES IN SCHEMA public is given to authenticated  754ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when GRANT INSERT lists multiple tables including counter_sale_payments  602ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when an unquoted policy grants client INSERT on counter_sale_payments  693ms
   ✓ no-client-writes-on-counter-sale-payments invariant > fails when GRANT INSERT uses quoted identifiers for schema and table  715ms
   ✓ no-client-writes-on-counter-sale-payments invariant > passes when only SELECT is granted to client and writes are denied  565ms
   ✓ post-counter-sale-writes-payments invariant > fails when the last migration defining post_counter_sale omits payment insert  728ms
   ✓ post-counter-sale-writes-payments invariant > passes when the last migration defining post_counter_sale inserts into counter_sale_payments  1214ms
 ✓ |store-unit| src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 212ms
 ✓ |store-unit| src/__tests__/admin-logic.test.ts (32 tests) 187ms
 ✓ |env-validation| tests/env-validation.test.ts (9 tests) 204ms
 ✓ |store-unit| src/__tests__/i18n-consistency.test.ts (16 tests) 191ms
 ✓ |store-unit| src/__tests__/costing-engine-replay.property.test.ts (4 tests) 72ms
 ✓ |store-unit| src/__tests__/admin-components.test.ts (17 tests) 74ms
 ✓ |store-unit| src/lib/settings/context.test.ts (32 tests) 47ms
 ✓ |store-unit| src/__tests__/i18n-preservation.test.ts (36 tests) 30ms
 ✓ |store-unit| src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 30ms
 ✓ |store-unit| src/__tests__/allow-negative-stock.test.ts (9 tests) 172ms
 ✓ |store-unit| src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 21ms
 ✓ |store-unit| src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 64ms
 ✓ |store-unit| src/__tests__/queries.test.ts (14 tests) 38ms
 ✓ |store-unit| src/__tests__/m2c-reservations-order.test.ts (3 tests) 26ms
 ✓ |store-unit| src/__tests__/barcode-pack-quantity.test.ts (6 tests) 25ms
 ✓ |store-unit| src/lib/settings/default-rendering.test.ts (17 tests) 90ms
 ✓ |store-unit| src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 28ms
 ✓ |store-unit| src/__tests__/m4-stock-signals.unit.test.ts (15 tests) 20ms
 ✓ |store-unit| src/__tests__/admin-i18n.property.test.ts (2 tests) 56ms
 ✓ |store-unit| src/lib/settings/theme-engine.test.ts (15 tests) 28ms
 ✓ |store-unit| src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 31ms
 ✓ |store-unit| src/__tests__/m4-stock-signals-ui.test.ts (4 tests) 32ms
 ✓ |store-unit| src/__tests__/image-proxy.unit.test.ts (25 tests) 27ms
 ✓ |store-unit| src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 24ms
 ✓ |store-unit| src/__tests__/storefront-ux.property.test.ts (25 tests) 4745ms
   ✓ Property 5: Breadcrumb path resolution produces valid ancestor chain > resolved path starts from root ancestor and ends at target category  370ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  2430ms
 ✓ |store-unit| src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 21ms
 ✓ |store-unit| src/__tests__/m4-null-availability.unit.test.ts (15 tests) 23ms
 ✓ |store-unit| src/components/admin/ImageCandidateGrid.test.ts (9 tests) 22ms
 ✓ |store-unit| src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 28ms
 ✓ |store-unit| src/__tests__/fixtures.test.ts (7 tests) 29ms
 ✓ |store-unit| src/__tests__/staff-cost-reachability.test.ts (6 tests) 26ms
 ✓ |store-unit| src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 25ms
 ✓ |store-unit| src/pages/admin/SettingsPage.test.ts (22 tests) 26ms
 ✓ |store-unit| src/__tests__/counter-input.test.ts (8 tests) 20ms
 ✓ |store-unit| src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 17ms
 ✓ |store-unit| src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 22ms
 ✓ |store-unit| src/__tests__/m2c-reservations-suite.test.ts (7 tests) 21ms
 ✓ |store-unit| src/__tests__/receiving-cost-integrity.test.ts (5 tests) 15ms
 ✓ |store-unit| src/__tests__/unit-cost-privacy.test.ts (3 tests) 13ms
 ✓ |store-unit| src/__tests__/stocktake-reconciliation.test.ts (4 tests) 16ms
 ✓ |store-unit| src/__tests__/adjustment-role-guards.test.ts (4 tests) 14ms
 ✓ |store-unit| src/__tests__/blind-counting-security.test.ts (4 tests) 15ms
 ✓ |store-unit| src/__tests__/stock-adjust-race.test.ts (2 tests) 14ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals-schema.test.ts (4 tests) 18ms
 ✓ |store-unit| src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 14ms
 ✓ |store-unit| src/__tests__/inventory-auth.test.ts (4 tests) 11ms
 ✓ |store-unit| src/__tests__/margin-report-granularity.test.ts (3 tests) 17ms
 ✓ |store-unit| src/__tests__/checkout-form-security.test.ts (1 test) 64ms
 ✓ |store-unit| src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 103ms
 ✓ |store-unit| src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 144ms

 Test Files  68 passed (68)
      Tests  749 passed (749)
   Start at  14:17:34
   Duration  22.41s (transform 18.30s, setup 0ms, collect 46.70s, tests 31.16s, environment 10.14s, prepare 81.61s)
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

---

# Audit Notes — fix/counter-sale-confirmation Round 3

**Date:** 2026-11-16  
**Branch:** `fix/counter-sale-confirmation`  
**Input:** `prompts/fix-counter-sale-confirmation-round-3.md`  

---

## 1. What Changed Per Item

### Item 1: The scanner never gets focus back after a quantity or tender edit (major)
- **File:** `artifacts/store/src/components/admin/counter/LookupBox.tsx`
- **Changes:**
  - Added an effect that attaches a `focusout` event listener to `document` which refocuses the input via `setTimeout(..., 0)` whenever `document.activeElement` is missing or is `document.body` (and the input is not disabled).
  - Updated the existing `[disabled, busy]` effect so that a finished lookup only focuses the input if focus has fallen to nothing, to `document.body`, or already on the input, preventing it from stealing focus if the cashier is actively typing in another form element.
- **Commit:** `fb04463 fix(counter): return scanner focus on focusout and protect active inputs`

### Item 2: A deterministic 5xx freezes the till with no way out (major)
- **Files:**
  - `artifacts/store/src/pages/admin/CounterPage.tsx`
  - `artifacts/store/src/components/admin/counter/CounterCheckoutPanel.tsx`
  - `artifacts/store/src/lib/i18n/messages/az.ts`
  - `artifacts/store/src/lib/i18n/messages/ru.ts`
  - `artifacts/store/src/lib/i18n/messages/en.ts`
- **Changes:**
  - In `CounterPage.tsx`:
    - Added `[failedAttempts, setFailedAttempts] = useState(0)` state.
    - Added `console.error(data.error)` and `setFailedAttempts((n) => n + 1)` in the `res.status >= 500` branch.
    - Added `setFailedAttempts((n) => n + 1)` in the `catch` block.
    - Reset `setFailedAttempts(0)` on successful sale completion and in the `ST020` branch.
    - Added `discardAttempt` handler resetting `saleId`, clearing `soldAtRef.current`, setting `pending` to false, closing confirm modal, resetting `failedAttempts` to 0, setting outcome error message with `Admin.Counter.discardedCheckSales`, and keeping the cart lines.
    - Passed `onDiscard={discardAttempt}` and `canDiscard={pending && outcome?.kind === "error" && failedAttempts >= 3}` to `CounterCheckoutPanel`.
  - In `CounterCheckoutPanel.tsx`:
    - Destructured and typed `canDiscard?: boolean` and `onDiscard?: () => void`.
    - Rendered a bordered secondary button directly below the Resend button when `canDiscard` is true, calling `onDiscard` and labelled `t("Admin.Counter.startOver")`.
  - In `az.ts`, `ru.ts`, `en.ts`:
    - Added translations for `startOver` and `discardedCheckSales`.
- **Commit:** `3bf07f7 fix(counter): add discard and start over button after 3 failed attempts`

### Item 3: A null or unparseable JSON body (minor)
- **File:** `artifacts/store/src/pages/admin/CounterPage.tsx`
- **Changes:**
  - Updated JSON body extraction to `(await res.json().catch(() => null)) ?? {}` so a JSON literal `null` cannot cause property access throws.
  - On the `res.ok` path, verified `data.sale_number` and `data.id`. If either is missing or falsy, avoids clearing the cart and treats it like a server error: closes modal, sets `networkError` outcome, keeps `pending`, keeps `soldAtRef`, and increments `failedAttempts`.
- **Commit:** `6323070 fix(counter): handle null json response and validate 200 payload fields`

### Item 4: In-SPA navigation while the outcome is unknown (minor)
- **File:** `artifacts/store/src/pages/admin/CounterPage.tsx`
- **Changes:**
  - While `pending` is true, rendered the "Satışlar" link as a non-interactive `<span>` with `className="text-sm text-muted-foreground"` instead of a `<Link>`.
- **Commit:** `6cf65cb fix(counter): disable sales navigation link while checkout is pending`

---

## 2. Tests Added, Changed, Deleted or Weakened

### Tests Added
None.

### Tests Changed
None.

### Tests Deleted or Weakened
None.

---

## 3. Blocked / Assumptions / Not Verified

- **Not verified:** Nothing here was run in a browser; specifically, Item 1's `focusout` behaviour and Item 2's discard button are unobserved.
- **Not verified:** The E2E tier (`artifacts/store/tests/e2e/counter-sale.spec.ts`) and integration tier (`api-integration`) were not run locally as they require a running API server, browser, and Supabase credentials; only the offline unit test (`store-unit`, `env-validation`), typecheck, and invariant audit tiers were run.
- **Blocked:** None.
- **Assumptions:** None.

---

## 4. Command Output

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
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### `pnpm test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-counter-sale
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/fix-counter-sale

 ✓ |store-unit| src/lib/settings/theme-engine.property.test.ts (4 tests) 51ms
 ✓ |store-unit| src/__tests__/admin-list.property.test.ts (7 tests) 54ms
 ✓ |store-unit| src/__tests__/translated-field.property.test.ts (3 tests) 49ms
 ✓ |store-unit| src/__tests__/counter-pricing.test.ts (10 tests) 72ms
 ✓ |store-unit| src/__tests__/cart-validation.test.ts (25 tests) 123ms
 ✓ |store-unit| src/__tests__/image-proxy.property.test.ts (5 tests) 67ms
 ✓ |store-unit| src/lib/settings/cms-rendering.property.test.ts (14 tests) 199ms
 ✓ |store-unit| src/__tests__/order-tracking.property.test.ts (6 tests) 142ms
 ✓ |store-unit| src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 76ms
 ✓ |store-unit| src/__tests__/invariant-definer-grants.test.ts (5 tests) 642ms
 ✓ |store-unit| src/__tests__/costing-engine-replay.property.test.ts (4 tests) 21ms
 ✓ |store-unit| src/__tests__/heading-hierarchy.property.test.ts (8 tests) 37ms
 ✓ |store-unit| src/__tests__/i18n-consistency.test.ts (16 tests) 24ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals.test.ts (7 tests) 900ms
 ✓ |store-unit| src/__tests__/i18n-split.property.test.ts (2 tests) 35ms
 ✓ |env-validation| tests/env-validation.test.ts (9 tests) 19ms
 ✓ |store-unit| src/__tests__/admin-logic.test.ts (32 tests) 22ms
 ✓ |store-unit| src/__tests__/stocktake-variance.test.ts (24 tests) 18ms
 ✓ |store-unit| src/__tests__/admin-components.property.test.ts (6 tests) 39ms
 ✓ |store-unit| src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 17ms
 ✓ |store-unit| src/__tests__/brand-marquee.test.ts (8 tests) 175ms
 ✓ |store-unit| src/__tests__/invariant-counter-sale-payments.test.ts (10 tests) 1263ms
 ✓ |store-unit| src/lib/settings/storefront-rendering.property.test.ts (11 tests) 317ms
 ✓ |store-unit| src/__tests__/allow-negative-stock.test.ts (9 tests) 16ms
 ✓ |store-unit| src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 15ms
 ✓ |store-unit| src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 11ms
 ✓ |store-unit| src/lib/settings/context.test.ts (32 tests) 14ms
 ✓ |store-unit| src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 12ms
 ✓ |store-unit| src/__tests__/i18n-preservation.test.ts (36 tests) 10ms
 ✓ |store-unit| src/__tests__/admin-components.test.ts (17 tests) 13ms
 ✓ |store-unit| src/__tests__/barcode-pack-quantity.test.ts (6 tests) 11ms
 ✓ |store-unit| src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 9ms
 ✓ |store-unit| src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 7ms
 ✓ |store-unit| src/__tests__/image-proxy.unit.test.ts (25 tests) 9ms
 ✓ |store-unit| src/__tests__/admin-i18n.property.test.ts (2 tests) 15ms
 ✓ |store-unit| src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 9ms
 ✓ |store-unit| src/__tests__/storefront-ux.property.test.ts (25 tests) 1369ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  1069ms
 ✓ |store-unit| src/__tests__/m2c-reservations-order.test.ts (3 tests) 8ms
 ✓ |store-unit| src/__tests__/queries.test.ts (14 tests) 7ms
 ✓ |store-unit| src/__tests__/m2c-reservations-suite.test.ts (7 tests) 7ms
 ✓ |store-unit| src/lib/settings/default-rendering.test.ts (17 tests) 7ms
 ✓ |store-unit| src/lib/settings/theme-engine.test.ts (15 tests) 8ms
 ✓ |store-unit| src/__tests__/m4-stock-signals-ui.test.ts (4 tests) 7ms
 ✓ |store-unit| src/__tests__/m4-null-availability.unit.test.ts (15 tests) 7ms
 ✓ |store-unit| src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 7ms
 ✓ |store-unit| src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 7ms
 ✓ |store-unit| src/__tests__/fixtures.test.ts (7 tests) 7ms
 ✓ |store-unit| src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 8ms
 ✓ |store-unit| src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 7ms
 ✓ |store-unit| src/__tests__/receiving-cost-integrity.test.ts (5 tests) 7ms
 ✓ |store-unit| src/__tests__/staff-cost-reachability.test.ts (6 tests) 7ms
 ✓ |store-unit| src/__tests__/m4-stock-signals.unit.test.ts (15 tests) 8ms
 ✓ |store-unit| src/pages/admin/SettingsPage.test.ts (22 tests) 7ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals-schema.test.ts (4 tests) 6ms
 ✓ |store-unit| src/__tests__/counter-input.test.ts (8 tests) 5ms
 ✓ |store-unit| src/__tests__/stocktake-reconciliation.test.ts (4 tests) 6ms
 ✓ |store-unit| src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 7ms
 ✓ |store-unit| src/__tests__/unit-cost-privacy.test.ts (3 tests) 6ms
 ✓ |store-unit| src/__tests__/blind-counting-security.test.ts (4 tests) 5ms
 ✓ |store-unit| src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 4ms
 ✓ |store-unit| src/components/admin/ImageCandidateGrid.test.ts (9 tests) 5ms
 ✓ |store-unit| src/__tests__/margin-report-granularity.test.ts (3 tests) 4ms
 ✓ |store-unit| src/__tests__/adjustment-role-guards.test.ts (4 tests) 4ms
 ✓ |store-unit| src/__tests__/stock-adjust-race.test.ts (2 tests) 4ms
 ✓ |store-unit| src/__tests__/inventory-auth.test.ts (4 tests) 3ms
 ✓ |store-unit| src/__tests__/checkout-form-security.test.ts (1 test) 29ms
 ✓ |store-unit| src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 47ms
 ✓ |store-unit| src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 52ms

 Test Files  68 passed (68)
      Tests  749 passed (749)
   Start at  14:48:19
   Duration  5.70s (transform 2.18s, setup 0ms, collect 9.74s, tests 6.18s, environment 4.47s, prepare 16.20s)
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
