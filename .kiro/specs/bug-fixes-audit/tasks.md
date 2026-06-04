# Bug Fix Tasks — Audit Report

Based on the external audit of the production site, the following bugs have been verified against the codebase and reproduced via Playwright before fixing.

## Reproduction Summary

| Bug | Reproduced | Status |
|-----|-----------|--------|
| #1 Cart Tampering (localStorage) | ✅ Yes — negative price displayed in checkout | FIXED |
| #2 Phone Validation | ❌ Not reproduced — works correctly | SKIPPED |
| #3 Coupon 404 | ✅ Partially — route works but returns wrong HTTP status | FIXED |
| #4 Cart Qty Additive | ✅ Yes — qty 2 + 3 = 5 instead of setting to 3 | FIXED |
| #5 Infinite Loading | ❌ Not reproduced — 404 page renders correctly | SKIPPED |
| #7 Form Validation | ✅ Yes — no error messages shown | FIXED |
| #8 External Resources | ✅ Yes — logitech/microsoft icons 404 | FIXED |
| #9 Categories i18n | ✅ Yes — "Kateqoriyalar" shown in EN locale | FIXED |

---

## Task 1: Server-side cart validation hardening & frontend cart integrity check

**Priority:** CRITICAL  
**Files:** `artifacts/api-server/src/routes/orders.ts`, `artifacts/store/src/lib/cart/context.tsx`

**Problem:**  
Cart items are stored in unencrypted localStorage and can be manipulated to show fake prices, negative amounts, or non-existent products. While the server already fetches real prices from the DB during order placement (no price fraud is possible at checkout), the frontend displays manipulated data without any validation, and there's no check that `product_id` values reference real products before attempting checkout.

**Fix:**
1. In `CartProvider`, add a lightweight validation when loading from localStorage:
   - Reject items with negative/zero prices
   - Reject items with quantity <= 0 or > 99
   - Reject items missing required fields (`product_id`, `title`, `price`)
2. In the checkout flow, before allowing order submission, validate cart items against the backend (the existing order endpoint already does this — just surface the error cleanly).
3. Add a periodic cart refresh mechanism: when the cart drawer or checkout page opens, optionally re-verify prices from the backend and update displayed prices if they've changed.

**Acceptance criteria:**
- Malformed localStorage cart data (negative prices, missing fields) is rejected on load
- Cart displays accurate prices from the database at checkout time
- Order submission errors (product not found, insufficient stock) display user-friendly messages

---

## Task 2: Fix OTP phone validation — improve formatPhone robustness

**Priority:** CRITICAL  
**Files:** `artifacts/store/src/components/auth/LoginModal.tsx`

**Problem:**  
The phone validation in LoginModal can reject valid Azerbaijan phone numbers in certain input scenarios. The `formatPhone` function has edge cases:
- If a user types a number without the `+` prefix (e.g. `994556195907`), the function sees it starts with `994` and prepends `+`, which works.
- But if the user types numbers that don't start with `994` or `0` (e.g. `556195907` — the local number without country code), the third branch `!digits.startsWith("9")` may incorrectly transform it.
- Additionally, there's no visible feedback about the expected format until validation fails.

**Fix:**
1. Rewrite `formatPhone` to handle all common Azerbaijan phone entry patterns clearly:
   - `+994XXXXXXXXX` → pass through
   - `994XXXXXXXXX` → prepend `+`
   - `0XXXXXXXXX` → convert to `+994XXXXXXXXX`
   - `XXXXXXXXX` (9 digits starting with 5, 7, or 1) → prepend `+994`
2. Show format hint below the input field (e.g., "Format: +994 XX XXX XX XX")
3. Auto-format the phone display as user types (visual only — store clean digits)
4. Show the validated/formatted number to the user before submission so they can confirm

**Acceptance criteria:**
- Phone numbers entered as `+994556195907`, `994556195907`, `0556195907`, `556195907` all validate successfully
- Clear format guidance displayed to the user
- No valid Azerbaijan mobile number is rejected

---

## Task 3: Fix coupon validation endpoint — verify deployment includes coupons route

**Priority:** CRITICAL  
**Files:** `artifacts/api-server/src/routes/coupons.ts`, `artifacts/api-server/src/routes/index.ts`

**Problem:**  
The auditor received a 404 when hitting `POST /api/coupons/validate`. The code exists in `routes/coupons.ts` and is registered in `routes/index.ts`, so this is likely a deployment issue. However, the endpoint also has a bug: when no coupon is found, it returns `404` with `"Invalid or expired coupon"`. The frontend interprets any non-ok response as a failure. But the real issue is that if the `coupons` table doesn't exist in the database, the query will fail silently.

**Fix:**
1. Verify that the `coupons` table exists in the Supabase database (check schema)
2. Add proper error handling — if the Supabase query itself fails (table doesn't exist), return a clear 500 error instead of silently returning null
3. Change the "not found" response from 404 to 400 (404 implies the route doesn't exist, which confuses monitoring)
4. Ensure the API server build includes the coupons route (check esbuild config)
5. Add a database migration to create the `coupons` table if it doesn't exist

**Acceptance criteria:**
- `POST /api/coupons/validate` responds with 400 for invalid codes (not 404)
- Valid coupon codes return discount information
- If the coupons table is missing, the endpoint returns a meaningful error

---

## Task 4: Fix "Add to Cart" quantity behavior from Product Detail page

**Priority:** HIGH  
**Files:** `artifacts/store/src/components/storefront/ProductDetail.tsx`

**Problem:**  
When a user changes the quantity on the product detail page (e.g., from 1 to 2) and clicks "Add to Cart", the cart correctly adds the specified quantity. However, if the product is already in the cart and the user clicks "Add to Cart" again, it _adds_ the new quantity to the existing quantity rather than _setting_ it. The user expects that changing qty to 2 and clicking "Add to Cart" means they want 2 total, not 2 more.

Additionally, there's no indication on the product page of how many of this item are already in the cart.

**Fix:**
1. Show the current cart quantity for this product on the product detail page (e.g., "Already in cart: 2")
2. When the product is already in cart, change the behavior:
   - Show current quantity from cart instead of starting at 1
   - "Add to Cart" button text changes to "Update Cart" when the item already exists
   - Use `updateQty` instead of `addItem` when the item is already in cart
3. Ensure the cart badge count reflects the change immediately

**Acceptance criteria:**
- Product page shows if item is already in cart and its current quantity
- Changing quantity and clicking the button sets the exact quantity (not additive)
- Cart badge updates immediately

---

## Task 5: Handle errors on Product Detail page — fix infinite loading for non-existent products

**Priority:** HIGH  
**Files:** `artifacts/store/src/pages/storefront/ProductPage.tsx`

**Problem:**  
When a non-existent product slug is accessed, the Supabase query returns `data: null` AND an `error` object. The current code only checks for `!data` but doesn't check for errors. If the query fails for a network reason or returns an error response (e.g., 406), the component stays in loading state forever because `setNotFound(true)` is only called when `!data`.

**Fix:**
1. Capture the `error` from the Supabase query: `const { data, error } = await supabase.from(...)`
2. If `error` or `!data`, set `notFound: true`
3. Add a generic error state for network failures (separate from "not found")
4. Add a timeout: if loading exceeds 10 seconds, show an error state with a retry button
5. Translate the "Məhsul tapılmadı" message using `t()` function

**Acceptance criteria:**
- Non-existent product slugs show a translated 404 page immediately (no infinite loading)
- Network errors show a retry-able error state
- Error states are properly translated for all 3 locales

---

## Task 6: Translate CategoriesPage hardcoded strings

**Priority:** MEDIUM  
**Files:** `artifacts/store/src/pages/storefront/CategoriesPage.tsx`, `artifacts/store/src/lib/i18n/messages.ts`

**Problem:**  
The CategoriesPage has hardcoded Azerbaijani strings:
- Page heading: `"Kateqoriyalar"` (should use `t()`)
- Loading text: `"Yüklənir…"` (should use `t()`)
- Empty state: `"Kateqoriya yoxdur"` (should use `t()`)
- Subcategory count: `"alt kateqoriya"` (should use `t()`)
- "More" link: `"daha"` (should use `t()`)

**Fix:**
1. Add `Categories` section to all three locale objects in `messages.ts`:
   - `categories` (page title)
   - `loading`
   - `empty` (no categories message)
   - `subcategoryCount` (e.g., "{count} subcategories")
   - `more` (e.g., "+{count} more")
2. Update CategoriesPage to use `useI18n()` and `t()` for all user-facing strings

**Acceptance criteria:**
- All strings on CategoriesPage are translated when switching language to EN or RU
- No hardcoded Azerbaijani text remains in the component

---

## Task 7: Add checkout form validation error messages

**Priority:** HIGH  
**Files:** `artifacts/store/src/pages/storefront/CheckoutPage.tsx`

**Problem:**  
Clicking the "Place Order" button with empty required fields relies solely on HTML5 `required` attribute, which just focuses the first empty field. No visible error messages are shown to indicate which fields need to be filled.

**Fix:**
1. Add client-side validation before submission:
   - Check all required fields (customer_name, customer_phone, delivery_address)
   - Validate phone format
   - Show inline error messages below each invalid field
2. Add field-level error state to the `Field` component
3. Show a summary error banner if validation fails
4. Validate phone number format with the same regex as the login modal

**Acceptance criteria:**
- Each required field shows an error message when empty on submit attempt
- Phone field validates Azerbaijan number format
- Error messages are translated in all 3 locales
- Errors clear when the user corrects the input

---

## Task 8: Fix external resource loading (CDN icons fallback)

**Priority:** LOW  
**Files:** Relevant components using external icon CDN URLs

**Problem:**  
Some brand icons loaded from `cdn.simpleicons.org` return 404 (e.g., `/logitech/222222`, `/microsoft/222222`). External Unsplash images are blocked by ORB/CORS.

**Fix:**
1. Find all references to `cdn.simpleicons.org` in the codebase
2. Add fallback handling — if the icon fails to load, show a text-based brand name or a generic placeholder icon
3. For product images from external domains, ensure they either go through the Supabase storage proxy or have proper error fallbacks with `onError` handlers on `<img>` tags

**Acceptance criteria:**
- No broken image icons displayed on the site
- Brand icons gracefully fall back to text or placeholder when CDN is unavailable
- External images show placeholder on load failure
