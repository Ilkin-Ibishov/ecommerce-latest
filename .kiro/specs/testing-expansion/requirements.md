# Requirements Document

## Introduction

This feature expands the existing testing infrastructure for the white-label e-commerce monorepo. It adds Playwright component tests for critical storefront components, property-based tests for business logic (coupon discounts, stock safety, cart merge), full end-to-end browser tests covering the purchase flow, a test data seeding script, coverage reporting with thresholds, parallel test isolation mechanisms, and a GitHub Actions CI pipeline. All tasks are designed to be independently executable by parallel sub-agent swarms.

## Glossary

- **Component_Test_Suite**: Playwright component tests that render React components in a real browser environment
- **PBT_Suite**: Property-based tests using fast-check that verify business logic invariants with randomized inputs
- **E2E_Test_Suite**: Full Playwright browser tests that exercise the storefront and API together in a real browser
- **Seed_Script**: A dedicated Node.js script that populates the database with products, categories, and test coupons for repeatable test runs
- **Coverage_Reporter**: Vitest's built-in coverage provider (v8) configured with threshold enforcement for critical paths
- **Test_Isolation_Layer**: The mechanism that generates unique identifiers (phone numbers, session IDs) per test worker to prevent collisions in parallel CI execution
- **CI_Pipeline**: A GitHub Actions workflow that installs dependencies, seeds test data, starts the API server, and runs all test suites
- **Coupon_Calculator**: The discount calculation logic that applies percentage or fixed discounts respecting minimum order amounts
- **Stock_Decrement_RPC**: The `decrement_stock_safe` Postgres RPC function that atomically reduces product stock
- **Cart_Merge_Operation**: The `/api/cart/merge` endpoint logic that combines guest cart items into an authenticated user's cart
- **Store_App**: The React SPA storefront application at `artifacts/store`
- **API_Server**: The Express 5 REST API at `artifacts/api-server`
- **Vitest_Workspace**: The root `vitest.workspace.ts` configuration that orchestrates all test projects

## Requirements

### Requirement 1: Header Component Test

**User Story:** As a developer, I want a Playwright component test for the Header component, so that navigation rendering and mobile menu behavior are verified in a real browser.

#### Acceptance Criteria

1. THE Component_Test_Suite SHALL include a test file for the Header component at `artifacts/store/tests/components/Header.spec.tsx`
2. WHEN the Header component is mounted at a desktop viewport width of 1024px or greater, THE Component_Test_Suite SHALL verify that the logo image, the "Məhsullar" navigation link, the "Kateqoriyalar" navigation link, and the cart icon button are visible
3. WHEN the Header component is mounted at a viewport width between 640px and 767px and the mobile menu toggle button is clicked, THE Component_Test_Suite SHALL verify that the navigation panel containing "Məhsullar" and "Kateqoriyalar" links becomes visible in the DOM
4. THE Component_Test_Suite SHALL render the Header component wrapped in CartProvider and a wouter Router context, and SHALL pass a valid locale prop (one of "az", "ru", or "en") to the Header component

### Requirement 2: CartDrawer Component Test

**User Story:** As a developer, I want a Playwright component test for the CartDrawer component, so that cart display and item interaction are verified in a real browser.

#### Acceptance Criteria

1. THE Component_Test_Suite SHALL include a test file for the CartDrawer component at `artifacts/store/tests/components/CartDrawer.spec.tsx`
2. WHEN the CartDrawer is mounted within a CartProvider containing at least 2 items and rendered with the `open` prop set to true, THE Component_Test_Suite SHALL verify that each item's title text, quantity value, and unit price formatted as a number with 2 decimal places followed by "AZN" are visible in the rendered output
3. WHEN a remove button (the Trash2 icon button associated with a specific item) is clicked, THE Component_Test_Suite SHALL verify that the removed item's title is no longer present in the rendered DOM
4. WHEN the CartDrawer is mounted within a CartProvider containing zero items and rendered with the `open` prop set to true, THE Component_Test_Suite SHALL verify that the text "Səbətiniz boşdur" is displayed
5. WHEN a quantity increment button (Plus icon) is clicked for an item, THE Component_Test_Suite SHALL verify that the displayed quantity for that item increases by 1

### Requirement 3: CheckoutPage Component Test

**User Story:** As a developer, I want a Playwright component test for the CheckoutPage, so that the checkout form rendering and validation are verified in a real browser.

#### Acceptance Criteria

1. THE Component_Test_Suite SHALL include a test file for the CheckoutPage component at `artifacts/store/tests/components/CheckoutPage.spec.tsx` that mounts the component wrapped in a CartProvider with at least 2 cart items, each containing product_id, slug, title, price, image, and quantity fields matching the CartItem interface
2. WHEN the CheckoutPage is mounted with cart items, THE Component_Test_Suite SHALL verify that each item's line total (price multiplied by quantity, formatted to 2 decimal places with "AZN" suffix) is visible in the order summary, and that the subtotal equals the sum of all line totals
3. WHEN required form fields (customer_name, customer_phone, delivery_address) are left empty and the submit button is clicked, THE Component_Test_Suite SHALL verify that the form is not submitted by confirming each of the 3 required fields has the HTML `required` attribute set
4. THE Component_Test_Suite SHALL verify that the customer name, phone, and delivery address input fields are visible and editable, and that the notes field is present as an optional textarea without the `required` attribute

### Requirement 4: Coupon Discount Calculation Property Tests

**User Story:** As a developer, I want property-based tests for coupon discount calculation, so that percentage and fixed discount logic is verified across a wide range of inputs including edge cases.

#### Acceptance Criteria

1. THE PBT_Suite SHALL include a test file at `artifacts/api-server/tests/coupon-calc.property.test.ts`
2. FOR ALL percentage coupons with discount_value in the range (0, 100] and subtotals in the range [0.01, 99_999_999.99], THE Coupon_Calculator SHALL produce a discount amount that is greater than or equal to 0 and less than or equal to the subtotal (metamorphic property)
3. FOR ALL fixed-amount coupons with discount_value in the range (0, 99_999_999.99] and subtotals in the range [0.01, 99_999_999.99], THE Coupon_Calculator SHALL produce a discount amount that equals the lesser of the coupon discount_value and the subtotal (idempotence-like cap property)
4. FOR ALL subtotals strictly less than a coupon's min_order_amount, THE Coupon_Calculator SHALL return an error indication that the minimum order amount was not met (error condition property)
5. WHEN the subtotal equals the coupon's min_order_amount exactly, THE Coupon_Calculator SHALL accept the coupon and compute the discount normally (boundary property)
6. FOR ALL percentage values in the range (0, 100] and subtotals in the range [0.01, 99_999_999.99], THE Coupon_Calculator SHALL produce a discount equal to `(subtotal * percentage) / 100`, rounded to at most 2 decimal places (model-based property)
7. FOR ALL coupons of any type and subtotals in the range [0.01, 99_999_999.99], THE Coupon_Calculator SHALL never produce a discount amount that exceeds the subtotal (non-negative-balance property)

### Requirement 5: Stock Decrement Safety Property Tests

**User Story:** As a developer, I want property-based tests for stock decrement logic, so that concurrent order scenarios never result in negative stock values.

#### Acceptance Criteria

1. THE PBT_Suite SHALL include a test file at `artifacts/api-server/tests/stock-safety.property.test.ts`
2. FOR ALL sequences of 2 to 20 decrement operations where the sum of requested quantities exceeds the initial stock (generated in range 0 to 1000), THE Stock_Decrement_RPC SHALL raise an exception for at least one operation such that the final stock value is greater than or equal to zero (error condition property)
3. FOR ALL valid decrement operations where quantity (generated in range 1 to 100) is less than or equal to the current stock, THE Stock_Decrement_RPC SHALL reduce stock by exactly the requested quantity and the resulting stock SHALL equal initial stock minus quantity (invariant property)
4. FOR ALL products with zero stock, THE Stock_Decrement_RPC SHALL raise an exception for any decrement quantity of 1 or greater (error condition property)
5. FOR ALL sequences of decrement operations applied to any product, THE Stock_Decrement_RPC SHALL maintain stock greater than or equal to zero after every operation in the sequence (safety invariant property)

### Requirement 6: Cart Merge Idempotency Property Tests

**User Story:** As a developer, I want property-based tests for cart merge logic, so that merging a guest cart into a user cart produces consistent results regardless of repetition.

#### Acceptance Criteria

1. THE PBT_Suite SHALL include a test file at `artifacts/api-server/tests/cart-merge.property.test.ts` that uses the `fast-check` library with `vitest` to define property-based tests for the cart merge operation
2. WHEN a guest cart containing between 1 and 10 distinct products (each with quantity between 1 and 50) is merged into an empty user cart, THE Cart_Merge_Operation SHALL produce a user cart where each product and its quantity exactly matches the corresponding guest cart entry (round-trip property)
3. WHEN a guest cart contains products that already exist in the user cart, THE Cart_Merge_Operation SHALL set the resulting quantity for each matching product to the sum of the user cart quantity and the guest cart quantity, capped at a maximum of 99 per product (additive-merge invariant property)
4. WHEN a merge operation is applied twice with the same session_id, THE Cart_Merge_Operation SHALL produce the same final cart state as a single merge, with the second invocation reporting zero items merged (idempotence property)
5. WHEN a guest cart contains products that do not exist in the user cart, THE Cart_Merge_Operation SHALL insert those products into the user cart with the guest cart quantities unchanged (disjoint-merge property)

### Requirement 7: E2E Happy-Path Purchase Flow

**User Story:** As a developer, I want a full end-to-end browser test covering the purchase flow (browse → add to cart → checkout → order confirmation), so that the storefront and API are verified working together.

#### Acceptance Criteria

1. THE E2E_Test_Suite SHALL include a test file at `artifacts/store/tests/e2e/purchase-flow.spec.ts`
2. WHEN the test navigates to the products page, THE E2E_Test_Suite SHALL verify that at least one product element containing a product name and price is visible within 10 seconds
3. WHEN the test clicks a product's add-to-cart control, THE E2E_Test_Suite SHALL verify that the cart badge count increments from 0 to 1
4. WHEN the test navigates to the checkout page, THE E2E_Test_Suite SHALL fill in the customer name field with a non-empty string of at most 100 characters, the phone field with a valid phone number format, and the delivery address field with a non-empty string of at most 250 characters
5. WHEN the test submits the order, THE E2E_Test_Suite SHALL verify that the order confirmation view is displayed containing a success heading and an order ID
6. THE E2E_Test_Suite SHALL use the Seed_Script data so that known products are available during the test run, with the seed executed before the test suite begins
7. IF the checkout flow requires user authentication, THEN THE E2E_Test_Suite SHALL authenticate the test user (via API-level session injection or login flow) before submitting the order
8. THE E2E_Test_Suite SHALL complete the full purchase flow within 60 seconds

### Requirement 8: Test Data Seeding Script

**User Story:** As a developer, I want a dedicated seeding script that populates products, categories, and test coupons, so that integration and E2E tests do not depend on manually-seeded data.

#### Acceptance Criteria

1. THE Seed_Script SHALL be located at `scripts/seed-test-data.ts` and executable via `pnpm run seed:test`
2. WHEN executed, THE Seed_Script SHALL insert at least 3 products with stock, 2 categories, and 2 test coupons (one percentage, one fixed-amount) into the Supabase database, where each product has a stock value of at least 10, at least one product_translations row (lang_code `en`), and at least one product_categories assignment
3. THE Seed_Script SHALL be idempotent — running it multiple times SHALL produce the same final state without duplicate records by using upsert operations keyed on the unique `slug` column for products, `slug` for categories, and `code` for coupons
4. THE Seed_Script SHALL use the `TEST_` prefix for coupon codes and the `test-` prefix for product slugs and category slugs so test data is distinguishable from production data
5. IF a required environment variable (`SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`) is missing, THEN THE Seed_Script SHALL exit with a non-zero exit code and an error message indicating which variable is missing
6. WHEN executed, THE Seed_Script SHALL insert coupons with `is_active` set to true and `expires_at` set to at least 1 year in the future, so that test coupons remain valid across test runs
7. WHEN the Seed_Script completes successfully, THE Seed_Script SHALL exit with code 0 and print a summary line indicating the count of products, categories, and coupons upserted

### Requirement 9: Coverage Reporting with Thresholds

**User Story:** As a developer, I want Vitest coverage reporting with enforced thresholds on critical paths, so that test coverage regressions are caught automatically.

#### Acceptance Criteria

1. THE Vitest_Workspace SHALL configure the v8 coverage provider in the API server integration test project
2. WHEN tests are run with the `--coverage` flag, THE Coverage_Reporter SHALL generate both an lcov report and a text summary report, writing output to a `coverage/` directory within the API server project root
3. THE Coverage_Reporter SHALL enforce a minimum 80% line coverage threshold applied per-file for all files matching `artifacts/api-server/src/routes/**`
4. IF coverage for any file subject to the threshold falls below 80% line coverage, THEN THE Coverage_Reporter SHALL cause the test command to exit with a non-zero code
5. THE Coverage_Reporter SHALL exclude files matching `**/*.test.ts`, `**/setup.ts`, `**/helpers/**`, and `**/*.d.ts` from coverage measurement
6. WHEN tests are run without the `--coverage` flag, THE Coverage_Reporter SHALL not perform coverage collection or threshold enforcement

### Requirement 10: Parallel Test Isolation

**User Story:** As a developer, I want test isolation mechanisms that prevent collisions when multiple CI workers run tests concurrently, so that tests remain deterministic in parallel execution.

#### Acceptance Criteria

1. THE Test_Isolation_Layer SHALL provide a helper function that generates unique phone numbers per test worker by combining the Azerbaijani country prefix `+99450` with a 7-digit suffix derived from the worker ID and a random component, producing a valid 13-character phone string matching the pattern `+99450XXXXXXX`
2. THE Test_Isolation_Layer SHALL provide a helper function that generates unique session IDs for guest cart operations per test worker, returning a string of 36 to 64 characters that incorporates the worker ID and a timestamp or random component
3. WHEN multiple test workers (up to 32 concurrent workers) execute concurrently, THE Test_Isolation_Layer SHALL ensure no two workers produce the same phone number or session ID across 10,000 sequential invocations per worker
4. THE Test_Isolation_Layer SHALL be importable from `artifacts/api-server/tests/helpers/isolation.ts`
5. WHEN a phone number is generated, THE Test_Isolation_Layer SHALL return a string that passes the same validation rules accepted by the `/api/auth/otp/verify` endpoint
6. WHEN a worker ID is not explicitly provided, THE Test_Isolation_Layer SHALL default to using a combination of `process.pid` and a random seed to derive uniqueness

### Requirement 11: GitHub Actions CI Pipeline

**User Story:** As a developer, I want a GitHub Actions workflow that runs all tests on push and PR, so that regressions are caught before merge.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL be defined at `.github/workflows/test.yml`
2. WHEN a push or pull request targets the main branch, THE CI_Pipeline SHALL trigger automatically
3. THE CI_Pipeline SHALL run on an Ubuntu latest runner using Node.js 20.x and pnpm 9.x
4. THE CI_Pipeline SHALL install pnpm dependencies with the pnpm store cached between runs
5. THE CI_Pipeline SHALL execute the Seed_Script (`pnpm --filter @workspace/api-server run seed`) before running integration and E2E tests
6. THE CI_Pipeline SHALL start the API_Server in the background and wait up to 30 seconds for it to respond on its health endpoint before running E2E and integration tests
7. THE CI_Pipeline SHALL run `pnpm test` and report the exit code as the workflow status
8. THE CI_Pipeline SHALL install Playwright browsers via `pnpm exec playwright install --with-deps` before running E2E and component tests
9. IF any test fails, THEN THE CI_Pipeline SHALL mark the workflow run as failed
10. THE CI_Pipeline SHALL enforce a workflow-level timeout of 15 minutes to prevent hung runs

### Requirement 12: E2E Test Configuration

**User Story:** As a developer, I want a Playwright configuration for full E2E browser tests, so that E2E tests are managed separately from component tests.

#### Acceptance Criteria

1. THE E2E_Test_Suite SHALL be configured via `artifacts/store/playwright.config.ts` (separate from the CT config at `artifacts/store/playwright-ct.config.ts`)
2. THE E2E_Test_Suite SHALL launch the Store_App dev server automatically using Playwright's `webServer` configuration with the command `pnpm --filter @workspace/store run dev`, a base URL of `http://localhost:3000`, and a startup timeout of 30 seconds
3. THE E2E_Test_Suite SHALL target Chromium as the default browser
4. THE E2E_Test_Suite SHALL set a base URL of `http://localhost:3000` so that all test navigation is relative to the local development server
5. THE E2E_Test_Suite SHALL store test results in `artifacts/store/test-results/` and capture traces on first retry
6. THE E2E_Test_Suite SHALL discover test files from the `artifacts/store/tests/e2e/` directory, keeping them separate from component tests in `artifacts/store/tests/components/`
