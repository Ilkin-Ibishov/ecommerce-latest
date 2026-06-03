# Implementation Plan: Testing Infrastructure

## Overview

Set up a Vitest workspace at the monorepo root that orchestrates two test projects: API integration tests (against a real Supabase instance) and Playwright component tests (for the React storefront). A single `pnpm test` command runs everything.

## Tasks

- [x] 1. Set up Vitest workspace and root test script
  - [x] 1.1 Install Vitest and create root workspace config
    - Add `vitest` as a root devDependency in `package.json`
    - Create `vitest.workspace.ts` at the repository root using `defineWorkspace` to reference `artifacts/api-server/vitest.config.ts` and `artifacts/store/playwright-ct.config.ts`
    - Add `"test": "vitest --run"` script to root `package.json`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 10.1, 10.2_

- [x] 2. Set up API integration test project
  - [x] 2.1 Create Vitest config for api-server integration tests
    - Create `artifacts/api-server/vitest.config.ts` with `defineConfig` — name `api-integration`, root set to `import.meta.dirname`, include `tests/**/*.test.ts`, setupFiles `tests/setup.ts`, node environment, 30s timeouts, shuffled sequence
    - Add `vitest` and `dotenv` as devDependencies in `artifacts/api-server/package.json`
    - _Requirements: 1.1, 10.1, 10.2, 10.3_

  - [x] 2.2 Create environment validation setup file
    - Create `artifacts/api-server/tests/setup.ts` that loads `.env` from repo root via `dotenv`, validates `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are present, throws descriptive error if any are missing, and sets `NODE_ENV=development`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.3 Write property test for environment validation
    - **Property 1: Missing environment variable produces identifiable error**
    - **Validates: Requirements 3.3**

  - [x] 2.4 Create auth test helper
    - Create `artifacts/api-server/tests/helpers/auth.ts` with `loginTestUser(baseUrl, phone)` that calls `/api/dev/mock-otp` to inject OTP, then `/api/auth/otp/verify` to get session tokens; returns `AuthSession` interface with `accessToken`, `refreshToken`, `userId`, `phone`
    - _Requirements: 4.5, 9.1_

  - [x] 2.5 Create cleanup utilities
    - Create `artifacts/api-server/tests/helpers/cleanup.ts` with `cleanupTestUser(userId)` that deletes order_items, orders, cart_items, coupon_usages, then the auth user via admin API; and `cleanupTestCoupon(couponId)` for coupon cleanup
    - Use `@supabase/supabase-js` admin client with `SUPABASE_SERVICE_ROLE_KEY`
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 3. Checkpoint - Ensure setup compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement auth integration tests
  - [x] 4.1 Write auth integration test file
    - Create `artifacts/api-server/tests/auth.test.ts` with tests for: sending OTP to a valid Azerbaijani phone number (`+994501234001`), verifying OTP returns a valid session token, submitting an invalid OTP returns 400-level error
    - Use `loginTestUser` helper and `cleanupTestUser` in `afterAll`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5. Implement cart integration tests
  - [x] 5.1 Write cart integration test file
    - Create `artifacts/api-server/tests/cart.test.ts` with tests for: adding a product to cart, updating cart item quantity, removing item from cart, confirming updated cart state in response, confirming 401 for unauthenticated requests
    - Authenticate via `loginTestUser`, clean up via `cleanupTestUser` in `afterAll`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 6. Implement orders integration tests
  - [x] 6.1 Write orders integration test file
    - Create `artifacts/api-server/tests/orders.test.ts` with tests for: creating an order with authenticated user, retrieving user's order list, confirming response includes order ID and status, confirming 401 for unauthenticated requests
    - Authenticate via `loginTestUser`, clean up via `cleanupTestUser` in `afterAll`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7. Implement coupons integration tests
  - [x] 7.1 Write coupons integration test file
    - Create `artifacts/api-server/tests/coupons.test.ts` with tests for: applying a valid coupon code, submitting an invalid/expired coupon code, confirming discount amount in response for valid coupon, confirming error response for invalid coupon
    - Insert test coupons (prefixed `TEST_`) in `beforeAll`, clean up via `cleanupTestCoupon` in `afterAll`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 8. Checkpoint - Ensure integration tests compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Set up Playwright component test project
  - [x] 9.1 Install Playwright CT dependencies and create config
    - Add `@playwright/experimental-ct-react` as a devDependency in `artifacts/store/package.json`
    - Create `artifacts/store/playwright-ct.config.ts` using `defineConfig` from `@playwright/experimental-ct-react/test`, set `testDir: "./tests/components"`, configure `ctViteConfig` with `@/` and `@assets/` path aliases matching the store's `vite.config.ts`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 9.2 Create a sample component test
    - Create `artifacts/store/tests/components/ProductCard.spec.tsx` that renders a ProductCard component in a real browser, verifies it displays product name and price, and confirms Tailwind styles are applied
    - _Requirements: 8.1, 8.4_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the environment validation correctness property from the design
- Integration tests run against a real Supabase instance — ensure `.env` has valid credentials before running
- Test phone numbers use the pattern `+994501234XXX` per the design's test data conventions
- Test coupon codes use the `TEST_` prefix per the design's conventions

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "9.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5"] },
    { "id": 3, "tasks": ["2.3", "4.1", "9.2"] },
    { "id": 4, "tasks": ["5.1", "6.1", "7.1"] }
  ]
}
```
