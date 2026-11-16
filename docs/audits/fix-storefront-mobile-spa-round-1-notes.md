# Implementation Notes — fix/storefront-mobile-spa Fix Round 1

**Date:** 2026-11-16  
**Branch:** `round/storefront-fix`  
**Inputs:** `prompts/fix-storefront-mobile-spa-round-1.md`, `AGENTS.md`, `.agents/rules/frontend.md`

---

## 1. Changes per Item

### Item 1 — Checkout shows a delivery fee the server never charges
- **File:** `artifacts/store/src/pages/storefront/CheckoutPage.tsx`
- **Change:**
  - Removed constants `FREE_DELIVERY_THRESHOLD` and `STANDARD_DELIVERY_FEE`.
  - Removed `isFreeDelivery` and `deliveryFee`.
  - Reverted `total` calculation back to `const total = Math.max(0, subtotal - discountAmount);`.
  - Restored delivery line in summary to match `origin/main` verbatim: `<div className="flex justify-between text-sm"><span>{t("Checkout.delivery")}</span><span className="text-green-600">{t("Checkout.free")}</span></div>`.
  - Preserved checkout draft persistence (`CHECKOUT_DRAFT_KEY`, `loadCheckoutDraft`).
- **Commit:** `42e101a fix(storefront): remove client-only delivery fee from checkout`

### Item 2 — Invented, industry-specific size-guide content
- **Files:**
  - `artifacts/store/src/components/storefront/SizeGuideOverlay.tsx`
  - `artifacts/store/src/components/storefront/ProductDetail.tsx`
  - `artifacts/store/src/pages/storefront/SizeGuidePage.tsx`
  - `artifacts/store/src/App.tsx`
- **Change:**
  - Restored `SizeGuideOverlay.tsx` from `origin/main`.
  - Restored both size guide hunks in `ProductDetail.tsx` to match `origin/main`: link only rendered inside `{sizeGuide && (...)}` with original comment, and overlay rendered only as `{categoryId && sizeGuide && (<SizeGuideOverlay categoryId={categoryId} ... />)}`; preserved removed breadcrumb and `<div className="py-4">`.
  - Deleted `pages/storefront/SizeGuidePage.tsx`.
  - Removed `SizeGuidePage` lazy import, `/${locale}/size-guide` route, and `/size-guide` redirect from `App.tsx`.
  - Verified no residual references to `size-guide"` or `SizeGuidePage` remain across `src/` except the two API endpoints (`/size-guides/${categoryId}`).
- **Commit:** `f81fedc fix(storefront): remove invented size guide page and fallback clothing table`

### Item 3 — A junk slug hard-coded in the home page
- **File:** `artifacts/store/src/pages/storefront/HomePage.tsx`
- **Change:**
  - Restored `HomePage.tsx` from `origin/main`, removing hardcoded filter for slug `"dsdvsdv"` and deal price `0`.
- **Commit:** `91187f1 fix(storefront): remove hardcoded test product slug filter from home page`

### Item 4 — `overflow-x: hidden` turns the page shell into scroll containers
- **Files:**
  - `artifacts/store/src/index.css`
  - `artifacts/store/src/App.tsx`
  - `artifacts/store/src/components/storefront/Header.tsx`
  - `artifacts/store/src/components/storefront/Footer.tsx`
  - `artifacts/store/src/components/storefront/AnnouncementBar.tsx`
- **Change:**
  - Queried `modern-web-guidance` (`search "overflow clip scroll container"` and `retrieve "overflow-clipping-control"`), confirming that `overflow: clip` clips content without creating a scroll container.
  - In `index.css`: changed `overflow-x: hidden` to `overflow-x: clip` on `html, body`.
  - Replaced `overflow-x-hidden` with `overflow-x-clip` in all five added locations across `App.tsx` (lines 112 & 114), `Header.tsx` (line 102), `Footer.tsx` (line 60), and `AnnouncementBar.tsx` (line 11).
- **Commit:** `55f9e13 fix(storefront): use overflow-x clip instead of hidden to avoid accidental scroll containers`

### Item 5 — Filter requests can land out of order
- **File:** `artifacts/store/src/pages/storefront/ProductsPage.tsx`
- **Change:**
  - In `useEffect` (`load()`): added `let cancelled = false;` before `load()`.
  - Added cleanup returning `() => { cancelled = true; };`.
  - Added `if (cancelled) return;` after each of the 5 `await` calls in `load()` prior to any `set...` state update.
- **Commit:** `62df555 fix(storefront): ignore out-of-order filter responses when query changes`

### Item 6 — Two one-line defects
- **Files:**
  - `artifacts/store/src/components/storefront/AnnouncementBar.tsx`
  - `artifacts/store/src/components/storefront/LocaleSwitcher.tsx`
- **Change:**
  - In `AnnouncementBar.tsx`: reverted span className from `text-center truncate sm:whitespace-normal` to `text-center`, preventing text truncation on mobile while retaining `px-8` on the parent.
  - In `LocaleSwitcher.tsx`: appended `window.location.hash || ""` after search query on locale switch, preserving URL hashes without changing full-page navigation.
- **Commit:** `d29e086 fix(storefront): fix mobile announcement truncation and preserve hash on locale switch`

---

## 2. Output of `git diff --stat origin/main`

```
 artifacts/store/src/App.tsx                        |   4 +-
 .../src/components/storefront/AnnouncementBar.tsx  |   2 +-
 .../store/src/components/storefront/CartDrawer.tsx |  11 ++-
 .../store/src/components/storefront/Footer.tsx     |   2 +-
 .../store/src/components/storefront/Header.tsx     |  21 ++--
 .../src/components/storefront/HeaderSearchBar.tsx  |   9 +-
 .../src/components/storefront/LocaleSwitcher.tsx   |   3 +-
 .../src/components/storefront/ProductDetail.tsx    |  11 +--
 .../src/components/storefront/TrustBadges.tsx      |   2 +-
 artifacts/store/src/index.css                      |   7 ++
 .../store/src/pages/storefront/CheckoutPage.tsx    |  27 ++++-
 .../store/src/pages/storefront/ProductsPage.tsx    |  26 ++++-
 prompts/fix-storefront-mobile-spa-round-1.md       | 110 +++++++++++++++++++++
 13 files changed, 203 insertions(+), 32 deletions(-)
```

---

## 3. Blocked / Assumptions / Not verified

- Nothing was run in a browser or on a phone.
- Item 4 (`overflow-x: clip`) in particular is unverified visually.
- The integration and E2E tiers (`api-integration`, `playwright`) were not run locally (they require live Supabase credentials and a running API server, running in CI).

---

## 4. Tests Deleted, Renamed or Weakened

None.

---

## 5. Real Output of Verification Commands

### `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-storefront
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-storefront
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
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-storefront
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/fix-storefront

 ✓ |store-unit| src/__tests__/cart-validation.test.ts (25 tests) 99ms
 ✓ |store-unit| src/__tests__/translated-field.property.test.ts (3 tests) 62ms
 ✓ |store-unit| src/lib/settings/theme-engine.property.test.ts (4 tests) 53ms
 ✓ |store-unit| src/__tests__/image-proxy.property.test.ts (5 tests) 64ms
 ✓ |store-unit| src/__tests__/counter-pricing.test.ts (10 tests) 51ms
 ✓ |store-unit| src/__tests__/admin-list.property.test.ts (7 tests) 69ms
 ✓ |store-unit| src/lib/settings/cms-rendering.property.test.ts (14 tests) 219ms
 ✓ |store-unit| src/__tests__/order-tracking.property.test.ts (6 tests) 165ms
 ✓ |store-unit| src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 98ms
 ✓ |store-unit| src/__tests__/invariant-definer-grants.test.ts (5 tests) 764ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals.test.ts (7 tests) 909ms
 ✓ |store-unit| src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 19ms
 ✓ |store-unit| src/__tests__/i18n-split.property.test.ts (2 tests) 34ms
 ✓ |store-unit| src/__tests__/heading-hierarchy.property.test.ts (8 tests) 69ms
 ✓ |store-unit| src/__tests__/costing-engine-replay.property.test.ts (4 tests) 22ms
 ✓ |store-unit| src/__tests__/allow-negative-stock.test.ts (9 tests) 17ms
 ✓ |store-unit| src/__tests__/i18n-consistency.test.ts (16 tests) 22ms
 ✓ |store-unit| src/__tests__/admin-components.property.test.ts (6 tests) 51ms
 ✓ |store-unit| src/__tests__/admin-logic.test.ts (32 tests) 26ms
 ✓ |store-unit| src/__tests__/brand-marquee.test.ts (8 tests) 240ms
 ✓ |store-unit| src/lib/settings/storefront-rendering.property.test.ts (11 tests) 341ms
 ✓ |store-unit| src/__tests__/invariant-counter-sale-payments.test.ts (10 tests) 1385ms
 ✓ |store-unit| src/__tests__/stocktake-variance.test.ts (24 tests) 20ms
 ✓ |env-validation| tests/env-validation.test.ts (9 tests) 20ms
 ✓ |store-unit| src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 17ms
 ✓ |store-unit| src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 10ms
 ✓ |store-unit| src/__tests__/admin-components.test.ts (17 tests) 15ms
 ✓ |store-unit| src/__tests__/i18n-preservation.test.ts (36 tests) 13ms
 ✓ |store-unit| src/__tests__/image-proxy.unit.test.ts (25 tests) 11ms
 ✓ |store-unit| src/lib/settings/context.test.ts (32 tests) 18ms
 ✓ |store-unit| src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 11ms
 ✓ |store-unit| src/__tests__/storefront-ux.property.test.ts (25 tests) 1329ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  938ms
 ✓ |store-unit| src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 13ms
 ✓ |store-unit| src/__tests__/m2c-reservations-order.test.ts (3 tests) 10ms
 ✓ |store-unit| src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 11ms
 ✓ |store-unit| src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 8ms
 ✓ |store-unit| src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 12ms
 ✓ |store-unit| src/__tests__/barcode-pack-quantity.test.ts (6 tests) 10ms
 ✓ |store-unit| src/__tests__/queries.test.ts (14 tests) 9ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals-schema.test.ts (4 tests) 7ms
 ✓ |store-unit| src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 8ms
 ✓ |store-unit| src/__tests__/m4-stock-signals-ui.test.ts (4 tests) 8ms
 ✓ |store-unit| src/__tests__/admin-i18n.property.test.ts (2 tests) 18ms
 ✓ |store-unit| src/lib/settings/theme-engine.test.ts (15 tests) 9ms
 ✓ |store-unit| src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 9ms
 ✓ |store-unit| src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 9ms
 ✓ |store-unit| src/__tests__/fixtures.test.ts (7 tests) 8ms
 ✓ |store-unit| src/lib/settings/default-rendering.test.ts (17 tests) 9ms
 ✓ |store-unit| src/__tests__/receiving-cost-integrity.test.ts (5 tests) 8ms
 ✓ |store-unit| src/__tests__/m4-null-availability.unit.test.ts (15 tests) 8ms
 ✓ |store-unit| src/__tests__/staff-cost-reachability.test.ts (6 tests) 8ms
 ✓ |store-unit| src/pages/admin/SettingsPage.test.ts (22 tests) 7ms
 ✓ |store-unit| src/__tests__/m2c-reservations-suite.test.ts (7 tests) 7ms
 ✓ |store-unit| src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 5ms
 ✓ |store-unit| src/__tests__/m4-stock-signals.unit.test.ts (15 tests) 8ms
 ✓ |store-unit| src/__tests__/blind-counting-security.test.ts (4 tests) 7ms
 ✓ |store-unit| src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 6ms
 ✓ |store-unit| src/__tests__/unit-cost-privacy.test.ts (3 tests) 5ms
 ✓ |store-unit| src/components/admin/ImageCandidateGrid.test.ts (9 tests) 6ms
 ✓ |store-unit| src/__tests__/stocktake-reconciliation.test.ts (4 tests) 6ms
 ✓ |store-unit| src/__tests__/margin-report-granularity.test.ts (3 tests) 5ms
 ✓ |store-unit| src/__tests__/stock-adjust-race.test.ts (2 tests) 5ms
 ✓ |store-unit| src/__tests__/inventory-auth.test.ts (4 tests) 4ms
 ✓ |store-unit| src/__tests__/adjustment-role-guards.test.ts (4 tests) 5ms
 ✓ |store-unit| src/__tests__/checkout-form-security.test.ts (1 test) 32ms
 ✓ |store-unit| src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 65ms
 ✓ |store-unit| src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 69ms

 Test Files  67 passed (67)
      Tests  741 passed (741)
   Start at  10:12:21
   Duration  5.99s (transform 2.73s, setup 0ms, collect 10.55s, tests 6.66s, environment 4.21s, prepare 18.73s)
```

### `pnpm run audit:invariants`
```
> workspace@0.0.0 audit:invariants C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-storefront
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

# Round 2

**Date:** 2026-11-16  
**Branch:** `round/storefront-fix`  
**Inputs:** `prompts/fix-storefront-mobile-spa-round-2.md`, `AGENTS.md`, `.agents/rules/frontend.md`

## 1. Changes per Item

### Item 1 — The cart button does nothing on the checkout page
- **File:** `artifacts/store/src/components/storefront/CartDrawer.tsx`
- **Change:**
  - Removed `useLocation` import from `wouter` (`import { Link } from "wouter";`).
  - Removed `const [location] = useLocation();`.
  - Removed `useEffect` closing drawer when `location.includes("/checkout")`.
  - Result: `git diff origin/main -- artifacts/store/src/components/storefront/CartDrawer.tsx` is completely empty.
- **Commit:** `b6eea6a fix(storefront): remove redundant auto-close effect from cart drawer`

### Item 2 — The suggestion dropdown reopens over the search results
- **File:** `artifacts/store/src/components/storefront/HeaderSearchBar.tsx`
- **Change:**
  - Added `const requestRef = useRef(0);`.
  - In `fetchSuggestions`: assigned `const requestId = ++requestRef.current;` after the `q.length < 2` guard.
  - Guarded `.then((data) => ...)`, `.catch(...)`, and `.finally(...)` with `if (requestId !== requestRef.current) return;`.
  - In `closeSuggestions`: cleared debounce timer (`if (debounceRef.current) clearTimeout(debounceRef.current);`), incremented `requestRef.current++;`, and called `setLoading(false);` before closing suggestions.
- **Commit:** `c4bad55 fix(storefront): ignore out-of-order suggestions and cancel pending requests on close`

### Item 3 — Scroll lock leaks behind the cart drawer
- **File:** `artifacts/store/src/index.css`
- **Change:**
  - Changed selector from `html, body` to `body` only for `{ max-width: 100%; overflow-x: clip; }`.
  - Preserves browser viewport scroll lock propagation from `body`'s inline `overflow: hidden` when overlays (cart drawer, product gallery, confirm dialog) open.
- **Commit:** `64c14a6 fix(storefront): restrict overflow-x clip to body to preserve viewport scroll lock`

### Item 4 — "You will pay 0.00 AZN" after an order
- **File:** `artifacts/store/src/pages/storefront/CheckoutPage.tsx`
- **Change:**
  - Added state `const [placedTotal, setPlacedTotal] = useState(0);`.
  - Called `setPlacedTotal(total);` immediately prior to `setPlaced(true);` before `clearCart()`.
  - Replaced `total.toFixed(2)` with `placedTotal.toFixed(2)` for `{amount}` in `Checkout.courierWillCall` on the order success screen.
- **Commit:** `67e1fd6 fix(storefront): snapshot placed total before clearing cart on checkout`

## 2. Blocked / Assumptions / Not verified

- Nothing was run in a browser or on a phone.
- Item 3 is derived from the CSS propagation rule and is unverified visually.
- Integration and E2E tiers (`api-integration`, `playwright`) were not run locally (they require live Supabase credentials and a running API server, running in CI).

## 3. Tests Deleted, Renamed or Weakened

None.

## 4. Real Output of Verification Commands

### `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-storefront
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-storefront
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
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-storefront
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest/.claude/worktrees/fix-storefront

 ✓ |store-unit| src/__tests__/heading-hierarchy.property.test.ts (8 tests) 40ms
 ✓ |store-unit| src/__tests__/cart-validation.test.ts (25 tests) 117ms
 ✓ |store-unit| src/__tests__/counter-pricing.test.ts (10 tests) 68ms
 ✓ |store-unit| src/lib/settings/theme-engine.property.test.ts (4 tests) 73ms
 ✓ |store-unit| src/__tests__/admin-list.property.test.ts (7 tests) 52ms
 ✓ |store-unit| src/__tests__/image-proxy.property.test.ts (5 tests) 69ms
 ✓ |store-unit| src/lib/settings/cms-rendering.property.test.ts (14 tests) 208ms
 ✓ |store-unit| src/__tests__/order-tracking.property.test.ts (6 tests) 192ms
 ✓ |store-unit| src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 76ms
 ✓ |store-unit| src/__tests__/invariant-definer-grants.test.ts (5 tests) 794ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals.test.ts (7 tests) 988ms
 ✓ |store-unit| src/__tests__/i18n-consistency.test.ts (16 tests) 28ms
 ✓ |store-unit| src/__tests__/m2c-reservations-view-security.test.ts (5 tests) 20ms
 ✓ |store-unit| src/__tests__/translated-field.property.test.ts (3 tests) 60ms
 ✓ |store-unit| src/__tests__/i18n-split.property.test.ts (2 tests) 44ms
 ✓ |env-validation| tests/env-validation.test.ts (9 tests) 18ms
 ✓ |store-unit| src/__tests__/admin-logic.test.ts (32 tests) 24ms
 ✓ |store-unit| src/__tests__/admin-components.property.test.ts (6 tests) 41ms
 ✓ |store-unit| src/__tests__/stocktake-variance.test.ts (24 tests) 19ms
 ✓ |store-unit| src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 17ms
 ✓ |store-unit| src/__tests__/invariant-counter-sale-payments.test.ts (10 tests) 1506ms
 ✓ |store-unit| src/__tests__/brand-marquee.test.ts (8 tests) 219ms
 ✓ |store-unit| src/lib/settings/storefront-rendering.property.test.ts (11 tests) 328ms
 ✓ |store-unit| src/__tests__/allow-negative-stock.test.ts (9 tests) 14ms
 ✓ |store-unit| src/__tests__/costing-engine-replay.property.test.ts (4 tests) 21ms
 ✓ |store-unit| src/__tests__/m2c-reservations-fulfilment.test.ts (3 tests) 14ms
 ✓ |store-unit| src/lib/settings/context.test.ts (32 tests) 17ms
 ✓ |store-unit| src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 12ms
 ✓ |store-unit| src/__tests__/i18n-preservation.test.ts (36 tests) 12ms
 ✓ |store-unit| src/__tests__/m2c-reservations-public-grant.test.ts (3 tests) 15ms
 ✓ |store-unit| src/__tests__/admin-components.test.ts (17 tests) 13ms
 ✓ |store-unit| src/__tests__/image-proxy.unit.test.ts (25 tests) 10ms
 ✓ |store-unit| src/__tests__/queries.test.ts (14 tests) 9ms
 ✓ |store-unit| src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 10ms
 ✓ |store-unit| src/__tests__/storefront-ux.property.test.ts (25 tests) 1536ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  1165ms
 ✓ |store-unit| src/__tests__/m2c-reservations-bypass-and-fulfil.test.ts (3 tests) 8ms
 ✓ |store-unit| src/__tests__/barcode-pack-quantity.test.ts (6 tests) 9ms
 ✓ |store-unit| src/__tests__/m2c-reservations-order.test.ts (3 tests) 9ms
 ✓ |store-unit| src/lib/settings/theme-engine.test.ts (15 tests) 9ms
 ✓ |store-unit| src/__tests__/admin-i18n.property.test.ts (2 tests) 15ms
 ✓ |store-unit| src/__tests__/m4-stock-signals.unit.test.ts (15 tests) 7ms
 ✓ |store-unit| src/__tests__/receiving-cost-integrity.test.ts (5 tests) 8ms
 ✓ |store-unit| src/lib/settings/default-rendering.test.ts (17 tests) 7ms
 ✓ |store-unit| src/pages/admin/SettingsPage.test.ts (22 tests) 8ms
 ✓ |store-unit| src/__tests__/m2c-reservations-effective-status.test.ts (2 tests) 8ms
 ✓ |store-unit| src/__tests__/m2c-reservations-availability-view.test.ts (3 tests) 7ms
 ✓ |store-unit| src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 11ms
 ✓ |store-unit| src/__tests__/m4-null-availability.unit.test.ts (15 tests) 10ms
 ✓ |store-unit| src/__tests__/staff-cost-reachability.test.ts (6 tests) 16ms
 ✓ |store-unit| src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 15ms
 ✓ |store-unit| src/__tests__/fixtures.test.ts (7 tests) 18ms
 ✓ |store-unit| src/components/admin/ImageCandidateGrid.test.ts (9 tests) 14ms
 ✓ |store-unit| src/__tests__/m2c-reservations-suite.test.ts (7 tests) 19ms
 ✓ |store-unit| src/__tests__/m4-stock-signals-ui.test.ts (4 tests) 24ms
 ✓ |store-unit| src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 22ms
 ✓ |store-unit| src/__tests__/unit-cost-privacy.test.ts (3 tests) 21ms
 ✓ |store-unit| src/__tests__/invariant-stock-signals-schema.test.ts (4 tests) 22ms
 ✓ |store-unit| src/__tests__/stock-adjust-race.test.ts (2 tests) 9ms
 ✓ |store-unit| src/__tests__/stocktake-reconciliation.test.ts (4 tests) 11ms
 ✓ |store-unit| src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 12ms
 ✓ |store-unit| src/__tests__/blind-counting-security.test.ts (4 tests) 14ms
 ✓ |store-unit| src/__tests__/margin-report-granularity.test.ts (3 tests) 15ms
 ✓ |store-unit| src/__tests__/adjustment-role-guards.test.ts (4 tests) 16ms
 ✓ |store-unit| src/__tests__/inventory-auth.test.ts (4 tests) 16ms
 ✓ |store-unit| src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 205ms
 ✓ |store-unit| src/__tests__/checkout-form-security.test.ts (1 test) 161ms
 ✓ |store-unit| src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 257ms

 Test Files  67 passed (67)
      Tests  741 passed (741)
   Start at  13:57:40
   Duration  13.34s (transform 5.19s, setup 0ms, collect 17.46s, tests 7.69s, environment 15.26s, prepare 27.14s)
```

### `pnpm run audit:invariants`
```
> workspace@0.0.0 audit:invariants C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\fix-storefront
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
