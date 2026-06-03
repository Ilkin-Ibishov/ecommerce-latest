# Implementation Plan: Testing Expansion

## Overview

This plan expands the test suite across three parallel tracks: Playwright component tests, fast-check property-based tests, and E2E infrastructure. The architecture maximizes parallelism — Wave 0 extracts pure functions needed by PBT tests, Wave 1 executes 11 independent tasks in parallel, Wave 2 writes the E2E purchase flow test (which depends on E2E config + seed script), and Wave 3 is the final checkpoint.

## Tasks

- [x] 1. Extract pure functions for property testing
  - [x] 1.1 Create coupon discount calculator module
    - Create file `artifacts/api-server/src/lib/coupon-calc.ts`
    - Export `Coupon` interface with fields: `discount_type: "percentage" | "fixed"`, `discount_value: number`, `min_order_amount: number | null`
    - Export `DiscountResult` discriminated union type: `{ ok: true; discount_amount: number } | { ok: false; error: string }`
    - Export `calculateDiscount(coupon: Coupon, subtotal: number): DiscountResult` function
    - Logic: check min_order_amount threshold → compute discount based on type → cap at subtotal → round to 2 decimals
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 1.2 Create cart merge pure function module
    - Create file `artifacts/api-server/src/lib/cart-merge.ts`
    - Export `CartEntry` interface: `{ product_id: string; quantity: number }`
    - Export `MergeResult` interface: `{ mergedCart: CartEntry[]; itemsMerged: number }`
    - Export constant `MAX_QUANTITY = 99`
    - Export `mergeGuestCart(userCart: CartEntry[], guestCart: CartEntry[]): MergeResult` function
    - Logic: build Map from userCart → iterate guestCart adding quantities (cap at 99) → return merged array + count
    - _Requirements: 6.2, 6.3, 6.4, 6.5_

  - [x] 1.3 Create stock decrement model for PBT
    - Create file `artifacts/api-server/tests/helpers/stock-model.ts`
    - Export `StockModel` class with: constructor(initialStock: number), `decrement(qty: number): { ok: boolean; remaining: number }`, `get current(): number`
    - Decrement logic: if qty > stock return `{ ok: false, remaining: this.stock }`; otherwise subtract and return `{ ok: true, remaining: this.stock }`
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

- [x] 2. Component tests (parallel)
  - [x] 2.1 Write Header component test
    - Create file `artifacts/store/tests/components/Header.spec.tsx`
    - Import `{ test, expect }` from `@playwright/experimental-ct-react`
    - Import Header from `@/components/storefront/Header`
    - Import CartProvider from `@/lib/cart/context`
    - Wrap Header in `<CartProvider>` and a wouter `<Router>` context, pass `locale="az"` prop
    - Test 1 "desktop nav visible": set viewport 1024×768, mount Header, assert logo img visible, assert "Məhsullar" link visible, assert "Kateqoriyalar" link visible, assert cart icon button visible
    - Test 2 "mobile menu toggle": set viewport 640×768, mount Header, click mobile menu toggle button, assert nav panel with "Məhsullar" and "Kateqoriyalar" links becomes visible
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 Write CartDrawer component test
    - Create file `artifacts/store/tests/components/CartDrawer.spec.tsx`
    - Import `{ test, expect }` from `@playwright/experimental-ct-react`
    - Import CartDrawer and CartProvider from relevant modules
    - Define mock cart items array with 2+ items matching CartItem interface: `{ product_id, slug, title, price, image, quantity }`
    - Test 1 "renders items with title, quantity, price": mount CartDrawer with `open={true}` inside CartProvider pre-loaded with items, assert each item title visible, quantity visible, price formatted as "X.XX AZN"
    - Test 2 "remove item": click Trash2 icon button for first item, assert that item's title no longer in DOM
    - Test 3 "empty state": mount with empty cart, assert "Səbətiniz boşdur" text visible
    - Test 4 "increment quantity": click Plus icon for first item, assert displayed quantity increased by 1
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.3 Write CheckoutPage component test
    - Create file `artifacts/store/tests/components/CheckoutPage.spec.tsx`
    - Import `{ test, expect }` from `@playwright/experimental-ct-react`
    - Import CheckoutPage and CartProvider
    - Define mock cart with 2+ items with all CartItem fields populated
    - Test 1 "line totals and subtotal": mount CheckoutPage in CartProvider, for each item assert `(price * quantity).toFixed(2) + " AZN"` visible, assert subtotal equals sum of line totals
    - Test 2 "required field validation": assert customer_name, customer_phone, delivery_address inputs have `required` attribute; assert notes textarea does NOT have `required`
    - Test 3 "fields visible and editable": assert name, phone, address inputs visible; fill each with test value; assert notes textarea visible
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Property-based tests (parallel)
  - [x] 3.1 Write coupon discount calculation property tests
    - Create file `artifacts/api-server/tests/coupon-calc.property.test.ts`
    - Import `{ describe, it, expect }` from `vitest`, `{ fc }` from `fast-check`
    - Import `calculateDiscount` from `../../src/lib/coupon-calc.ts`
    - Use `{ numRuns: 100 }` for all properties
    - **Property 1: Percentage discount matches model formula** — generate percentage in (0, 100], subtotal in [0.01, 99_999_999.99], no min_order_amount; assert discount === Math.round((subtotal * percentage) / 100 * 100) / 100
    - **Property 2: Fixed discount capped at subtotal** — generate fixed discount_value in (0, 99_999_999.99], subtotal in [0.01, 99_999_999.99]; assert discount === Math.min(discount_value, subtotal)
    - **Property 3: Discount never exceeds subtotal** — generate any coupon type, any valid values; assert 0 <= discount_amount <= subtotal
    - **Property 4: Below min_order_amount produces error** — generate min_order_amount > 0, subtotal < min_order_amount; assert result.ok === false
    - **Property 5: At min_order_amount boundary, coupon accepted** — generate min_order_amount > 0, set subtotal = min_order_amount; assert result.ok === true
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**

  - [x] 3.2 Write stock decrement safety property tests
    - Create file `artifacts/api-server/tests/stock-safety.property.test.ts`
    - Import `{ describe, it, expect }` from `vitest`, `{ fc }` from `fast-check`
    - Import `StockModel` from `./helpers/stock-model.ts`
    - Use `{ numRuns: 100 }` for all properties
    - **Property 6: Stock decrement reduces by exact quantity** — generate initial stock in [1, 1000], qty in [1, initial]; assert remaining === initial - qty
    - **Property 7: Zero stock rejects all decrements** — generate qty >= 1; model with stock 0; assert decrement returns ok: false and remaining: 0
    - **Property 8: Stock never goes negative under any sequence** — generate initial in [0, 1000], array of 1-20 ops (qty 1-100); apply sequence skipping invalid; assert stock >= 0 at every step
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5**

  - [x] 3.3 Write cart merge idempotency property tests
    - Create file `artifacts/api-server/tests/cart-merge.property.test.ts`
    - Import `{ describe, it, expect }` from `vitest`, `{ fc }` from `fast-check`
    - Import `mergeGuestCart` from `../../src/lib/cart-merge.ts`
    - Use `{ numRuns: 100 }` for all properties
    - **Property 9: Disjoint guest cart merge preserves quantities** — generate user cart and guest cart with disjoint product_ids (1-10 items, qty 1-50); assert merged contains all items with original quantities
    - **Property 10: Overlapping merge is additive with cap at 99** — generate overlapping carts; assert merged quantity === min(user_qty + guest_qty, 99)
    - **Property 11: Cart merge is idempotent** — merge once, then merge again with empty guest cart; assert same result, second merge reports 0 items merged
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5**

- [x] 4. Test infrastructure (parallel)
  - [x] 4.1 Create parallel test isolation helpers
    - Create file `artifacts/api-server/tests/helpers/isolation.ts`
    - Export `generatePhone(workerId?: number): string` — combine `+99450` prefix + 3-digit worker part (from workerId % 1000 padded) + 4-digit random part; return 13-char string matching `^\+99450\d{7}$`
    - Export `generateSessionId(workerId?: number): string` — combine `sess_w${id}_${timestamp base36}_${random base36}`; ensure length 36-64 chars
    - Default workerId: `process.pid ^ Math.floor(Math.random() * 10000)` when not provided
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 4.2 Configure coverage reporting in API server vitest config
    - Modify file `artifacts/api-server/vitest.config.ts`
    - Add `coverage` object to the test config: `{ provider: "v8", reporter: ["lcov", "text"], reportsDirectory: "./coverage", include: ["src/routes/**"], exclude: ["**/*.test.ts", "**/setup.ts", "**/helpers/**", "**/*.d.ts"], thresholds: { perFile: true, lines: 80 } }`
    - Ensure coverage only activates when `--coverage` flag is passed (default Vitest behavior)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 4.3 Create E2E Playwright configuration
    - Create file `artifacts/store/playwright.config.ts`
    - Import `{ defineConfig }` from `@playwright/test`
    - Set `testDir: "./tests/e2e"`, `outputDir: "./test-results"`
    - Configure `use: { baseURL: "http://localhost:3000", trace: "on-first-retry" }`
    - Add `projects: [{ name: "chromium", use: { browserName: "chromium" } }]`
    - Add `webServer: { command: "pnpm --filter @workspace/store run dev", url: "http://localhost:3000", timeout: 30_000, reuseExistingServer: true }`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 4.4 Create test data seeding script
    - Create file `scripts/seed-test-data.ts`
    - Import `createClient` from `@supabase/supabase-js`
    - Validate env vars: exit with code 1 and stderr message if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` missing
    - Create Supabase client with service role key
    - Upsert 3 products: slugs `test-product-1`, `test-product-2`, `test-product-3` with stock >= 10 each, using `slug` as conflict key
    - Upsert product_translations for each product (lang_code: "en")
    - Upsert 2 categories: slugs `test-category-1`, `test-category-2`, using `slug` as conflict key
    - Upsert product_categories linking products to categories
    - Upsert 2 coupons: `TEST_10PCT` (percentage, 10% off, is_active: true, expires_at: 1 year future) and `TEST_5AZN` (fixed, 5 AZN, is_active: true, expires_at: 1 year future), using `code` as conflict key
    - On success: exit 0, print summary of upserted counts
    - Add `"seed:test"` script to root `package.json`: `"tsx scripts/seed-test-data.ts"`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 4.5 Create GitHub Actions CI pipeline
    - Create file `.github/workflows/test.yml`
    - Trigger on push to main and pull_request to main
    - Job `test` on `ubuntu-latest`, timeout 15 minutes
    - Steps: checkout → pnpm/action-setup@v4 → setup-node@v4 (node 20, cache: pnpm) → `pnpm install --frozen-lockfile` → `pnpm exec playwright install --with-deps` → `pnpm run seed:test` → start API server in background (`pnpm --filter @workspace/api-server run start &`) → wait for health endpoint (loop curl localhost:5000/api/health, 30s timeout) → `pnpm test` → report exit code
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_

- [x] 5. Checkpoint - Ensure all Wave 0 and Wave 1 tasks pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. E2E purchase flow test
  - [x] 6.1 Write E2E happy-path purchase flow test
    - Create file `artifacts/store/tests/e2e/purchase-flow.spec.ts`
    - Import `{ test, expect }` from `@playwright/test`
    - Assumes seed data already populated (products with `test-` slug prefix exist)
    - Test "complete purchase flow": navigate to products page → assert at least one product visible within 10s → click add-to-cart on first product → assert cart badge shows "1" → navigate to checkout → fill customer_name (max 100 chars), customer_phone (valid format), delivery_address (max 250 chars) → if auth required, inject session via API or login flow → submit order → assert order confirmation view with success heading and order ID visible
    - Set test timeout to 60 seconds
    - Use isolation helpers for phone number generation if auth is needed
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit/component tests validate specific examples and edge cases
- All Wave 1 tasks (2.1–2.3, 3.1–3.3, 4.1–4.5) are independently executable by parallel sub-agents
- Wave 0 (tasks 1.1–1.3) must complete first as PBT tests import the extracted pure functions
- Only task 6.1 (E2E purchase flow) has dependencies on Wave 1 outputs (E2E config 4.3 + seed script 4.4 + isolation helpers 4.1)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "3.1", "3.2", "3.3", "4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 2, "tasks": ["6.1"] }
  ]
}
```
