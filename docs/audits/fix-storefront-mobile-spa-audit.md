# Audit: fix/storefront-mobile-spa

- Date: 2026-11-15
- Branch audited: `fix/storefront-mobile-spa` (audit branch `audit/storefront-mobile-spa`)
- Commits: `79933e0` fix(storefront): resolve mobile layout, checkout drawer, delivery fee and pdp defects; `f57142c` fix(storefront): use spa navigation for filters and search, preserve query params across locales
- Diff: `main...fix/storefront-mobile-spa`, 15 files, +322 / -65

## Verdict

Not approved: checkout now shows and asks the customer to pay a 5 AZN delivery fee that the server never adds, and the size-guide work ships invented measurement data and hard-coded, apparel-named, non-`t()` content.

## Findings

### 1. blocker - `artifacts/store/src/pages/storefront/CheckoutPage.tsx:14-15,131-134,323-331`
Delivery fee (`STANDARD_DELIVERY_FEE = 5`, threshold `100`) is a browser-only constant. `artifacts/api-server/src/routes/orders.ts:116` computes `totalAzn = subtotal - discountAmount` and stores it as `total_azn`; there is no delivery fee anywhere in the order route.
Scenario: cart subtotal 99.99, no coupon. Checkout displays "5.00 AZN" delivery, total 104.99, button "Place order · 104.99 AZN", and the success message tells the customer the courier will collect 104.99 (`courierWillCall`, line ~212). The API stores `total_azn = 99.99`. Customer, order record and admin disagree by 5 AZN on every order under 100 AZN. The requirement for this task is that the fee and total are the server's numbers.
Fix: compute the fee server-side in `orders.ts` (and return it), have checkout read it from the server (or from a settings value both use), or remove the fee display.

### 2. major - `artifacts/store/src/pages/storefront/ProductsPage.tsx:50-123`
The data-loading effect has no cancellation or request-id guard. Filters are now client-side navigations (previously a full reload made this impossible).
Scenario: user toggles "in stock" (slow: extra availability query plus the main query), then immediately sets price 10-50. Request A (in stock) resolves after request B; `setProducts/setCount` from A overwrite B, so the URL says `pmin=10&pmax=50` while the grid shows the in-stock-only results. Fix: `let cancelled = false` in the effect with a cleanup, or a request counter.

### 3. major - `artifacts/store/src/components/storefront/SizeGuideOverlay.tsx:98-138` (also `ProductDetail.tsx:262-270,438-440`)
When the size-guide fetch fails or returns no data, the overlay now shows a hard-coded XS-XXL clothing chest/waist/hip table. The "link only renders if size guide data exists" gate (old comment: Req 7.7) was removed, so the link shows on every in-stock product, and `categoryId ?? ""` calls `/size-guides/?locale=...`.
Scenario: customer opens a product in a category with no size guide (a phone case, a kettle) and taps "Size Guide": gets invented clothing measurements presented as authoritative. Also: header cells are literal "Ölçü / Size", "Sinə / Chest (sm)" etc. (not `t()`); link text is `t("SizeGuide.header") — t("Footer.allProducts") || "Bütün ölçülər"`, which renders "Size Guide — All Products" (wrong meaning; `t` returns a string so the `||` fallback is dead); the `<a href>` at line 132 causes a full page reload instead of a wouter `Link`; the `SizeGuide.error` key is now unused. Fix: restore the gate and error state; show a static table only on the dedicated page, if at all.

### 4. major - `artifacts/store/src/pages/storefront/SizeGuidePage.tsx:1-164`
All page copy is chosen with `isAz ? ... : isRu ? ... : ...` ternaries (tab labels, headers, tips, breadcrumb), not `t()` with keys in `az.ts/ru.ts/en.ts`. This breaks the zero-hard-coded-strings rule, and the i18n-consistency test cannot see it. Identifiers `CLOTHING_SIZES`, `SHOE_SIZES`, icons `Shirt`/`Footprints` and the clothing/shoes tabs hard-wire one industry, against the house rule on identifiers named after a customer's industry. Content has typos ("Sinə / Grud", "Omba / Bëdra" mixing AZ/RU/Latin) and an emoji in a heading.
Scenario: a shop selling electronics gets a `/size-guide` page of clothing and shoe sizes. Tabs are plain buttons without `role="tab"`/`aria-selected` (minor a11y).

### 5. major (unconfirmed) - `artifacts/store/src/index.css:538-543`, `artifacts/store/src/App.tsx:112,114`, `artifacts/store/src/components/storefront/Header.tsx:102`
Unconditional `html, body { overflow-x: hidden }` (applies to admin too) plus `overflow-x-hidden` on the layout wrapper, `main`, footer, announcement bar and the sticky `<header>`. Non-visible overflow on one axis makes the other axis `auto`, turning these elements into scroll containers. Expected consequences: (a) the sticky header (`Header.tsx:102`) is a descendant of the layout div with `overflow-x-hidden`, so `position: sticky` binds to that non-scrolling container and the header stops sticking; (b) absolutely positioned search suggestions or dropdowns that extend below the header are clipped or scrolled inside it. It also hides horizontal overflow instead of fixing its cause.
Confirm: scroll a long product list at phone width and see whether the header stays; open search suggestions and see whether they are cut off.

### 6. major - `artifacts/store/src/pages/storefront/HomePage.tsx:147,261`
`isRealDeal` filters out a product with the literal slug `"dsdvsdv"` (test data) and any price `<= 0`. Production code keyed on one junk slug from one database; a legitimately zero-priced deal is silently hidden.
Scenario: admin marks a promo item at price 0 as deal of the day: the section never renders. Test data should be cleaned in the database, not special-cased in code.

### 7. minor - `artifacts/store/src/components/storefront/LocaleSwitcher.tsx:11-12`
Locale switch is still a full-page `window.location.href` assignment, not SPA navigation. The query string is preserved (`window.location.search`) but the hash is dropped and React state reloads. The checkout draft in `sessionStorage` (finding 8) exists only to patch the data loss from this reload.
Scenario: `/az/products?sort=price_asc&pmin=10#reviews` switched to EN keeps the query, loses `#reviews`. Use `setLocation` with the search appended.

### 8. minor - `artifacts/store/src/pages/storefront/CheckoutPage.tsx:13,26-31,54-56`
Customer name, phone and address are written to `sessionStorage` on every keystroke and removed only after a successful order.
Scenario: shopper on a shared device abandons checkout; PII remains until the tab closes. New PII persistence that was not asked for.

### 9. minor - `artifacts/store/src/pages/storefront/CheckoutPage.tsx:14`, `artifacts/store/src/components/storefront/CartDrawer.tsx:9`
`FREE_DELIVERY_THRESHOLD = 100` is duplicated in two files and compared with the pre-discount subtotal.
Scenario: subtotal 100.00 with a -30 coupon: fee 0, customer pays 70 (free delivery granted on a 70 AZN payment); subtotal 99.99 pays +5. Empty cart: subtotal 0 gives fee 5 and total 5.00 (the page shows an empty state first, but the value is wrong if reached). Float subtotal is not rounded before comparing. Exactly 100.00 is free (`>=`), consistent with CartDrawer.

### 10. minor - no tests added
`git diff --stat main...HEAD -- '*test*'` is empty. New logic without a test: delivery fee/threshold calculation, the draft load/save helper, `isRealDeal`. A test comparing the client total with the order route would have caught finding 1.

### 11. minor - `artifacts/store/src/components/storefront/AnnouncementBar.tsx:13`
`truncate sm:whitespace-normal` clips the free-delivery message to one line with an ellipsis on phones.
Scenario: 360 px viewport, the AZ/RU message is cut and the threshold is unreadable.

### 12. minor - `artifacts/store/src/components/storefront/SizeGuideOverlay.tsx:70-79`
Redundant focus handling: a `useEffect` focuses the trigger whenever `open` is false, plus a `setTimeout` focus in `handleOpenChange`; Radix `Dialog` already restores focus. Because the overlay is now mounted only when `sizeGuideOpen` is true (`ProductDetail.tsx:438`), closing unmounts the dialog without its exit animation. Escape handling itself is Radix's and fine. Confirm in a browser.

## Confirmed correct

- Search submit/suggestion navigation uses `setLocation` and `encodeURIComponent(query.trim())`; `&`, `#`, `%`, spaces and non-Latin letters are encoded correctly. Whether `SearchPage` reads `q` correctly was not read.
- `ProductsPage` filter changes call `setLocation` (history push, so Back restores the previous filter); `buildUrl` and the submit handler `p.delete("page")`, so pagination resets on every filter change; effect deps include all params (`sale, deal, page, sort, brand, instock, pmin, pmax`) so a query change refetches (apart from finding 2). `priceMin/priceMax` inputs resync from the URL.
- No `window.location` assignment remains in `ProductsPage.tsx` or `HeaderSearchBar.tsx`; the only one left is `LocaleSwitcher` (finding 7).
- `SizeGuidePage` is registered at `/${locale}/size-guide` inside `StorefrontRoutes` (all three locales); `/size-guide` redirects to `/az/size-guide`.
- The removed breadcrumb in `ProductDetail` is not a loss: `ProductPage.tsx` already provides the container and `StorefrontBreadcrumb`.
- `CartDrawer` resets `document.body.style.overflow = ""` in the effect cleanup, so closing does not leave `overflow: hidden` on body; the header effect closes cart, mobile nav and search on route change.
- No `as any`, `@ts-ignore`, `.skip(`, eslint-disable, new dependency or deleted/weakened test was added in the diff. `SizeGuidePage.tsx` is 164 lines (under 200).
- `SizeGuide.header` exists in all three dictionaries.

## Ran

- `pnpm install --frozen-lockfile`: node_modules was missing; "Done in 52s using pnpm v10.15.0".
- `pnpm run typecheck`: passed (`artifacts/store typecheck: Done`, `artifacts/api-server typecheck: Done`, all workspaces Done).
- `pnpm test:unit`: `Test Files 62 passed (62)`, `Tests 696 passed (696)`, Duration 16.54s.
- `pnpm run audit:invariants`: "All invariant checks passed."
- Not run: integration, E2E, env-validation (need Supabase and a running API; they run in CI).

## Not checked

- Nothing was rendered or exercised in a browser or on a phone: findings 5, 11 and 12 come from reading CSS and markup and are unconfirmed.
- `SearchPage` reading of `q`; whether the mobile nav sets its own body overflow.
- Admin pages for regressions from the global `html, body` overflow rule.
- Whether the `modern-web-guidance` search/retrieve step required by `.agents/rules/frontend.md` was done: git holds no record of it.
- The order route was read, not executed.

## Merge order

`git diff --name-only main...m4/stock-signals-core` intersected with this branch: `App.tsx`, `ProductDetail.tsx`, `HomePage.tsx`, `ProductsPage.tsx`. `CheckoutPage.tsx` is not changed by m4. `git merge-tree --write-tree HEAD m4/stock-signals-core` produced a tree with no conflict output.

- `artifacts/store/src/App.tsx`: different lines (this branch: import, layout classes, size-guide routes near 27/112/187/272; m4: admin import and admin route near 34/136). No overlap.
- `artifacts/store/src/components/storefront/ProductDetail.tsx`: different lines but close. This branch edits old lines 152-161 (breadcrumb), 269-280 (size guide link) and 449-451; m4 edits old lines 132-137, 239 and 262. Old line 262 vs 269 is within about 7 lines, so a manual look is advisable; git merges cleanly.
- `artifacts/store/src/pages/storefront/HomePage.tsx`: same `load()` block, different lines. This branch edits 146-150, 176-180, 259; m4 edits 159-166 (availability map nullability). m4 makes `availMap` values `number | null`; this branch's edits do not touch that code, so no logical clash found.
- `artifacts/store/src/pages/storefront/ProductsPage.tsx`: different lines. This branch edits 2, 17, 41, 139, 212, 350; m4 edits 58, 82-84 (availability handling in `load`). No overlap.
