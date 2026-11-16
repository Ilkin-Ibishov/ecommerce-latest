# Audit: fix/storefront-mobile-spa — round 1 re-audit

- Date: 2026-11-16
- Branch audited: `origin/fix/storefront-mobile-spa` at `d231663` (audit branch `audit/storefront-mobile-spa-round-1`)
- Diff: `git diff origin/main...origin/fix/storefront-mobile-spa`, 12 files under `artifacts/store/src/` (+ the fix prompt and builder notes)
- Previous audit: `docs/audits/fix-storefront-mobile-spa-audit.md` on `origin/audit/storefront-mobile-spa` (12 findings)
- The builder notes were not used as evidence. Every `file:line` below was read at `d231663`.
- All paths are under `artifacts/store/src/` unless they start with `artifacts/`.

## Verdict

FIX — the round-1 blocker and all other first-audit items that were to be fixed are fixed in code, but the branch still introduces a dead cart button on the checkout page, a search dropdown that re-opens over the results page on desktop, and (unconfirmed, needs a browser) a global `html` overflow rule that defeats the three `body` scroll locks; checkout also still tells the customer a wrong amount in two cases that already exist on `main`.

## Status of the 12 original findings

| # | Original finding | Status at `d231663` | Evidence |
|---|---|---|---|
| 1 | Client-only delivery fee in checkout (blocker) | Fixed | `pages/storefront/CheckoutPage.tsx:136` is `const total = Math.max(0, subtotal - discountAmount);`; `:328` is the same delivery row as `main`; no `STANDARD_DELIVERY_FEE` / `FREE_DELIVERY_THRESHOLD` in the file. Server: `artifacts/api-server/src/routes/orders.ts:116`. |
| 2 | No request-order guard in `ProductsPage` | Fixed | `pages/storefront/ProductsPage.tsx:50` flag, `:66,83,90,119,127` one `if (cancelled) return;` after each of the five awaits and before every `set…`, cleanup `:134-136`. |
| 3 | Invented size table in `SizeGuideOverlay` / ungated link | Fixed | `SizeGuideOverlay.tsx` has no diff against `main`; `ProductDetail.tsx` diff is only the breadcrumb hunk. |
| 4 | `SizeGuidePage.tsx` | Fixed | File absent; no `SizeGuidePage` or `size-guide"` in `src/` except the query key at `components/storefront/SizeGuideOverlay.tsx:64` (main's file); `App.tsx` diff is only the two layout class lines (`:112`, `:114`). |
| 5 | `overflow-x: hidden` scroll containers / sticky header | Fixed in code, not confirmed visually | `index.css:541` `overflow-x: clip`; `overflow-x-clip` at `App.tsx:112,114`, `Header.tsx:102`, `Footer.tsx:60`, `AnnouncementBar.tsx:11`; no `overflow-x-hidden` added by the branch remains. See new finding 3 for what the `html` half of the rule still breaks. |
| 6 | `"dsdvsdv"` slug filter in `HomePage` | Fixed | `HomePage.tsx` has no diff against `main`; string absent from `src/`. |
| 7 | Locale switch drops hash, full reload | Hash fixed; full reload deliberately left | `components/storefront/LocaleSwitcher.tsx:11-12`. |
| 8 | Checkout draft (PII) in `sessionStorage` | Deliberately left | `CheckoutPage.tsx:13-29,47,51-55,200`. Not a finding. |
| 9 | `FREE_DELIVERY_THRESHOLD` duplicated / pre-discount | Checkout half removed; `CartDrawer.tsx:9` deliberately left | Not a finding. |
| 10 | No tests added | Deliberately left | `git diff --stat origin/main...HEAD -- '*test*' '*spec*'` is empty. Not a finding. |
| 11 | Announcement text truncated on phones | Fixed | `components/storefront/AnnouncementBar.tsx:13` is `text-center`; `px-8` kept at `:11`. |
| 12 | Redundant focus handling / overlay unmount | Fixed | Same evidence as 3 (file restored, mount condition restored). |

## Findings

### Introduced by this branch

### 1. major — `components/storefront/CartDrawer.tsx:55-59`
The "close on checkout" effect runs whenever `open` is true and the path contains `/checkout`, not only when the path changes to checkout. It therefore closes the drawer the instant it is opened on the checkout page.
Scenario: customer is on `/az/checkout` with 2 items and wants 3 of one of them. Taps the cart icon (`Header.tsx:160` desktop, `Header.tsx:267` mobile bottom nav) → `setCartOpen(true)` → effect sees `open && location.includes("/checkout")` → `onClose()`. The drawer never opens; the cart button is dead on that page. Checkout itself only has a remove button (`CheckoutPage.tsx:318`), no quantity control, so on `main` the drawer was the only way to change a quantity without leaving checkout. Second case: `includes` is a substring test, so a product whose slug contains `checkout` (`/az/products/self-checkout-stand`) has the same dead cart button.
Fix: delete the effect. Navigation to checkout is already covered twice: the link's own `onClick={onClose}` (`CartDrawer.tsx:281`) and the header effect (`Header.tsx:76-80`).

### 2. major — `components/storefront/HeaderSearchBar.tsx:84-90` (with `:25-43`, `:49`)
`handleSubmit` navigates with `setLocation` but does not clear the pending debounce timer or ignore the in-flight suggestion fetch. On `main` the full-page navigation destroyed both. The desktop inline bar (`Header.tsx:125`, `onClose` is a no-op) now stays mounted across the navigation.
Scenario: desktop, type `nike` and press Enter within the 250 ms debounce (`:49`) or while `/search/suggest` is still in flight. `handleSubmit` closes the suggestions and goes to `/az/search?q=nike`; then the timer fires / the fetch resolves and `:36` calls `setShowSuggestions(true)`. The suggestion dropdown opens on top of the search results page and stays until the user clicks outside or presses Escape. Typing and pressing Enter straight away is the normal way to search, so this hits most desktop searches. (Mobile is not affected: `onClose` unmounts the bar and the cleanup at `:93-95` clears the timer.)
Fix: in `handleSubmit` (and the Enter branch at `:62-73`) `clearTimeout(debounceRef.current)` and bump a request counter that `fetchSuggestions` checks before `setShowSuggestions(true)`.

### 3. minor (unconfirmed, needs a browser) — `index.css:538-542`
The rule sets `overflow-x: clip` on `html` as well as `body`. A `body` overflow value is applied to the viewport only while the root element's overflow is `visible` on both axes; once `html` is `clip` on one axis, `document.body.style.overflow = "hidden"` only affects the body box (auto height, clips nothing) and the viewport keeps scrolling. Three places rely on exactly that inline style as their scroll lock: `components/storefront/CartDrawer.tsx:50`, `components/storefront/ProductGallery.tsx:104`, `components/admin/ConfirmDialog.tsx:35`. `main` has no `html`/`body` overflow rule, so the locks work there.
Scenario: phone, open a product image in the lightbox and swipe vertically → the page behind scrolls; close the lightbox and the product page is at a different position. Same with the wheel over the cart drawer backdrop on desktop, and behind the admin confirm dialog.
Fix: drop `html` from the selector (keep `body`), or lock scroll on `document.documentElement`. The wrapper `div` at `App.tsx:112` already clips the storefront, so the global rule is not needed for the storefront at all.

### 4. minor — `pages/storefront/ProductsPage.tsx:154-160` (with `:39`, `:296-300`; `App.tsx:101-103`)
On a phone, "apply price" used to reload the page, which closed the filter panel and put the results at the top. It is now `setLocation` with only the query string changing: `filterOpen` stays true and `ScrollToTop` is keyed on the pathname, so nothing scrolls.
Scenario: 360 px wide, open "Filter", enter 10–50, tap "Apply". The panel (type, stock, brand list, price, categories) stays open and fills the screen; the grid below it changes off-screen. The only visible change is the badge count. The user sees no result of the tap.
Fix: `setFilterOpen(false)` in `applyPriceFilter` and in the two clear-price handlers (`:230-233`, `:370-373`).

### 5. minor — `lib/i18n/messages/az.ts:106-107`, `ru.ts:106-107`, `en.ts:106-107`
`ProductDetail.home` and `ProductDetail.productsLink` have no remaining reader after the breadcrumb was removed from `components/storefront/ProductDetail.tsx:153` (`grep` for both keys in `src/` returns nothing). Dead keys in all three dictionaries. The fix prompt forbade deleting keys in round 1, so this is left over by instruction, not by oversight; remove them in the next round or record them as intentionally kept.

### Present on `main` as well (not introduced by this branch; reported because the question "does checkout show what the server stores" was asked)

### 6. major — `pages/storefront/CheckoutPage.tsx:197-198,214` (same code on `main`)
The success screen computes the amount from the live cart after the cart has been cleared. `clearCart()` (`:198`) empties `items` (`lib/cart/context.tsx:68-69`), so `subtotal` is 0 and `total` (`:136`) is `Math.max(0, 0 - discountAmount)` = 0 on the render that shows `placed`.
Scenario: cart 99.99 AZN, no coupon, place order. Server stores `total_azn = 99.99` (`artifacts/api-server/src/routes/orders.ts:116,146`). The success message (`Checkout.courierWillCall`, `en.ts:189`) reads "You will pay 0.00 AZN cash on delivery". Same with a coupon. The first audit's statement that this message showed 104.99 was not correct; it shows 0.00 on `main` and on this branch.
Fix: capture the total in state before `clearCart()` (or return `total_azn` from `POST /orders`, which today returns only `orderId`, `orders.ts:251`, and display that).

### 7. major — `pages/storefront/CheckoutPage.tsx:135-136,123-131,318` (same code on `main`)
`discountAmount` is the number returned when the coupon was validated (`:150`, or restored from `localStorage` at `:123-131`) and is never recomputed when the cart changes. The server recomputes the discount from the current subtotal and silently drops the coupon if it no longer qualifies (`orders.ts:99-112`; `artifacts/api-server/src/lib/coupon-calc.ts:15,24`).
Scenario A: 10 % coupon applied at subtotal 200 → discount 20.00. Customer removes a 100 AZN item with the trash button (`:318`). Summary and button show 100.00 − 20.00 = "Place order · 80.00 AZN" (`:297,330`). Server: 10 % of 100 = 10 → `total_azn = 90`. Customer was shown 10 AZN less than the order records.
Scenario B: coupon with `min_order_amount = 150`, same removal. Server: `result.ok` is false, no discount, order still succeeds with `total_azn = 100`; customer was shown 80.00 and gets no error.
Without a coupon the pre-submit summary and button equal the server total (subject to the variant-price caveat under Not checked).
Fix: re-validate the coupon whenever `subtotal` changes (or clear it), and have the order route reject, not ignore, a coupon that no longer applies.

### 8. minor (unconfirmed, needs a browser) — `pages/storefront/ProductsPage.tsx:169,298,312` (same code on `main`)
`FilterSidebar` is a component declared inside `ProductsPage`'s render, so every state change (each `setPriceMin`/`setPriceMax` keystroke at `:210,218`) gives it a new identity and React remounts the subtree. Expected effect: the price input loses focus after every typed digit. This, not the resync effect at `:43-46`, is what would disturb typing. The branch did not add it, but it made the price inputs part of an SPA flow.
Fix: render it as `{FilterSidebar()}` or lift it out of the component.

## Confirmed correct

- Checkout, no coupon, before submit: summary total (`CheckoutPage.tsx:330`) and button label (`:297`) are `subtotal`, which is what `orders.ts:116` stores, as long as the cart price equals the price the order route uses (see Not checked). The delivery row (`:328`) is byte-identical to `main`.
- `ProductsPage` guard: all five awaits are followed by `if (cancelled) return;` before any `set…` (`:66,83,90,119,127`). `loading` cannot stick: a cancelled run returns without `setLoading(false)`, but cancellation only happens on unmount or when a newer run has already called `setLoading(true)` (`:52`) and will reach `:131`. A thrown rejection would leave it true, but that path is unchanged from `main` and supabase-js returns errors instead of throwing.
- `priceMin/priceMax` resync (`ProductsPage.tsx:43-46`) depends only on the URL values, so it fires only when `pmin`/`pmax` in the URL change; a brand/stock/sort navigation does not overwrite an unapplied typed value. It does discard an unapplied value when the price chip is cleared or on Back, which is the correct direction.
- `Header.tsx:76-80`: wouter 3.9.0 `useLocation` is the pathname only (`node_modules/wouter/src/use-browser-location.js:42-45,62`), so the effect does not fire on query-only navigation. Every programmatic navigation in the storefront (`ProductsPage.tsx:159,232,372`, `Header.tsx:271`, `HeaderSearchBar.tsx:67,70,87`) is a direct result of a user action, so I found no case where the effect closes something the user opened after the navigation. Residual gap, also on `main`: on a phone at `/az/search?q=a`, tapping "view all" for another query changes only the query string, so the mobile search bar stays open (`SearchSuggestions.tsx:148-151` passes `onSelect={closeSuggestions}`, not the bar's `onClose`).
- `HeaderSearchBar.tsx:62-73`: Enter on an active suggestion calls `e.preventDefault()` (`:63`) before navigating, so the form's `handleSubmit` does not also fire; `onClose()` there is a no-op for the desktop bar and unmounts the mobile bar. Query is encoded (`:87`).
- `overflow-x: clip` on the shell: every horizontal scroller inside the clipped containers has its own `overflow-x-auto` box (`ProductDetail.tsx:181`, `ProductGallery.tsx:345`, `RecentlyViewed.tsx:110`, `StorefrontBreadcrumb.tsx:145`, `SizeGuideOverlay.tsx:114`). Admin content scrolls inside its own `main` (`pages/admin/AdminLayout.tsx:261`, `overflow-y-auto`), `components/ui/table.tsx:9` wraps its table in `overflow-auto`, and hand-written admin/platform tables sit in `overflow-hidden` cards (`pages/admin/CouponsPage.tsx:106`, `pages/platform/AnalyticsPage.tsx:211`, `pages/platform/BillingPage.tsx:204`), so nothing found relied on page-level horizontal scroll.
- Breadcrumb: `pages/storefront/ProductPage.tsx:140-145` provides the container and `StorefrontBreadcrumb`; `ProductPage.tsx:146` is the only caller of `ProductDetail`, so removing the inner breadcrumb and container (`ProductDetail.tsx:153`) loses nothing.
- No `as any`, `@ts-ignore`, `eslint-disable` or `.skip(` on any added line of the diff; no new hard-coded user-visible string on any added line; no test file touched; no dependency change; no change under `artifacts/api-server/` or `supabase/`.
- `LocaleSwitcher.tsx:11-12` keeps query and hash. `TrustBadges.tsx:41` only drops `truncate`.

## Ran

`pnpm install --frozen-lockfile --prefer-offline` first (node_modules was missing).

`pnpm run typecheck` — exit 0:
```
artifacts/supabase-types typecheck: Done
scripts typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

`pnpm test:unit` — exit 0:
```
 Test Files  67 passed (67)
      Tests  741 passed (741)
   Start at  10:27:01
   Duration  62.23s (transform 35.33s, setup 0ms, collect 119.68s, tests 31.74s, environment 107.34s, prepare 39.01s)
```

`pnpm run audit:invariants` — exit 0:
```
ok    no-client-writes-on-counter-sale-payments 0 total, 0 new
ok    post-counter-sale-writes-payments 0 total, 0 new
ok    no-non-tracked-variant-movements 0 total, 0 new
ok    signals-have-one-derivation      0 total, 0 new
ok    no-undispatched-notification-type 0 total, 0 new

All invariant checks passed.
```

Not run: `api-integration`, `env-validation`, Playwright E2E (need Supabase credentials and a running API; CI only). No browser was used.

## Not checked

Needs a browser or phone to confirm:
- Finding 3 (scroll lock behind cart drawer, gallery lightbox, admin confirm dialog). Derived from the CSS overflow propagation rule, not observed.
- Finding 8 (price input focus loss). Derived from React's remount rule, not observed.
- Original finding 5: that the header really sticks and search suggestions are not cut off with `overflow-x: clip`; behaviour on browsers without `overflow: clip` support (the declaration is dropped, nothing is clipped).
- Finding 2 timing, finding 1 flash of the drawer, finding 4 on a real phone.
- Announcement bar wrapping at 360 px with the AZ/RU text; logo `max-w-[140px]` (`Header.tsx:114,117`) against a wide logo.

Not verified from code:
- Whether a product's default-variant price can differ from `products.price`. Checkout shows `products.price` (`artifacts/api-server/src/routes/products.ts:21-22`, used at `CheckoutPage.tsx:83-93`); the order route charges the variant price when a variant exists (`orders.ts:66`). If the two can differ in data, the pre-submit total is wrong even without a coupon. No database was touched to check.
- `total_azn` rounding: the server stores `subtotal - discountAmount` unrounded (`orders.ts:116`); the column type was not read.
- `SearchPage` was only checked to use `useSearch` (`pages/storefront/SearchPage.tsx:26`), not how it refetches.
- Whether the `modern-web-guidance` step required by `.agents/rules/frontend.md` was done for the `clip` change: git holds no record.
- The order and coupon routes were read, not executed.
