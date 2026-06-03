# Requirements Document

## Introduction

This feature establishes the testing infrastructure for the white-label e-commerce monorepo. It introduces a Vitest workspace configuration at the repository root, Supabase integration tests for critical API paths (orders, cart, auth, coupons), and Playwright component tests for critical React components. The goal is a single `pnpm test` command that runs all test suites across the monorepo.

## Glossary

- **Test_Runner**: Vitest — the test framework used for unit and integration tests across the monorepo
- **Workspace_Config**: The `vitest.workspace.ts` file at the repository root that defines all test projects
- **Integration_Test_Suite**: The collection of tests that exercise API routes against a real Supabase instance
- **Component_Test_Suite**: The collection of Playwright component tests that render React components in a real browser
- **Test_Environment**: The set of environment variables and configuration required to connect to a Supabase test instance
- **OTP_Dev_Store**: The in-memory OTP store active in non-production mode, used to bypass SMS delivery during tests
- **Critical_Paths**: The orders, cart, auth, and coupons API domains identified as MVP test scope
- **Test_Command**: The root-level `pnpm test` script that triggers all test suites

## Requirements

### Requirement 1: Vitest Workspace Configuration

**User Story:** As a developer, I want a single Vitest workspace configuration at the monorepo root, so that all test suites run with one command.

#### Acceptance Criteria

1. THE Workspace_Config SHALL define test projects for the Integration_Test_Suite and the Component_Test_Suite.
2. THE Workspace_Config SHALL reside at the repository root as `vitest.workspace.ts`.
3. WHEN a developer executes the Test_Command, THE Test_Runner SHALL discover and execute all test projects defined in the Workspace_Config.
4. THE Workspace_Config SHALL use ESM module syntax consistent with the monorepo TypeScript configuration.

### Requirement 2: Root Test Script

**User Story:** As a developer, I want a single `pnpm test` command at the root, so that I can run all tests without navigating to individual packages.

#### Acceptance Criteria

1. THE root `package.json` SHALL include a `test` script that invokes the Test_Runner with the Workspace_Config.
2. WHEN the Test_Command is executed, THE Test_Runner SHALL run all configured test projects and report results to stdout.
3. IF any test in any project fails, THEN THE Test_Command SHALL exit with a non-zero exit code.

### Requirement 3: Test Environment Configuration

**User Story:** As a developer, I want test environment variables loaded automatically, so that integration tests can connect to the Supabase test instance without manual setup.

#### Acceptance Criteria

1. THE Test_Environment SHALL require `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` variables to connect to the test Supabase instance.
2. WHEN the Integration_Test_Suite starts, THE Test_Runner SHALL load environment variables from a `.env` or `.env.test` file at the repository root.
3. IF a required environment variable is missing, THEN THE Integration_Test_Suite SHALL fail immediately with a descriptive error message identifying the missing variable.
4. THE Test_Environment SHALL include `NODE_ENV` set to `development` so that the OTP_Dev_Store is active during test execution.

### Requirement 4: Auth Integration Tests

**User Story:** As a developer, I want integration tests for the auth flow, so that phone OTP login is verified against the real Supabase instance.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL include tests that exercise the `/api/auth/send-otp` endpoint with a valid Azerbaijani phone number.
2. THE Integration_Test_Suite SHALL include tests that exercise the `/api/auth/verify-otp` endpoint using a code retrieved from the OTP_Dev_Store.
3. WHEN a valid OTP is verified, THE Integration_Test_Suite SHALL confirm that a valid session token is returned.
4. WHEN an invalid OTP is submitted, THE Integration_Test_Suite SHALL confirm that the API returns a 400-level error response.
5. THE Integration_Test_Suite SHALL use the `devGetLastOTP` or `devInjectOTP` helper to obtain OTP codes without SMS delivery.

### Requirement 5: Cart Integration Tests

**User Story:** As a developer, I want integration tests for cart operations, so that add-to-cart, update quantity, and remove-from-cart flows are verified.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL include tests that exercise adding a product to the cart via the `/api/cart` endpoint.
2. THE Integration_Test_Suite SHALL include tests that exercise updating the quantity of a cart item.
3. THE Integration_Test_Suite SHALL include tests that exercise removing an item from the cart.
4. WHEN a cart operation succeeds, THE Integration_Test_Suite SHALL confirm that the response contains the updated cart state.
5. IF an unauthenticated request is made to a cart endpoint, THEN THE Integration_Test_Suite SHALL confirm that the API returns a 401 status code.

### Requirement 6: Orders Integration Tests

**User Story:** As a developer, I want integration tests for the order lifecycle, so that order creation and retrieval are verified end-to-end.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL include tests that exercise creating an order via the `/api/orders` endpoint with an authenticated user.
2. THE Integration_Test_Suite SHALL include tests that exercise retrieving a user's order list.
3. WHEN an order is created successfully, THE Integration_Test_Suite SHALL confirm that the response includes an order ID and status.
4. IF an unauthenticated request is made to an orders endpoint, THEN THE Integration_Test_Suite SHALL confirm that the API returns a 401 status code.

### Requirement 7: Coupons Integration Tests

**User Story:** As a developer, I want integration tests for coupon validation, so that valid and invalid coupon scenarios are verified.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL include tests that exercise applying a valid coupon code via the `/api/coupons` endpoint.
2. THE Integration_Test_Suite SHALL include tests that exercise submitting an invalid or expired coupon code.
3. WHEN a valid coupon is applied, THE Integration_Test_Suite SHALL confirm that the response includes the discount amount or percentage.
4. WHEN an invalid coupon is submitted, THE Integration_Test_Suite SHALL confirm that the API returns an error response indicating the coupon is invalid.

### Requirement 8: Playwright Component Test Configuration

**User Story:** As a developer, I want Playwright component tests configured for the store frontend, so that critical React components are tested in a real browser environment.

#### Acceptance Criteria

1. THE Component_Test_Suite SHALL use Playwright's component testing mode to render React components in a real browser.
2. THE Component_Test_Suite SHALL be configured as a separate project within the Workspace_Config.
3. THE Component_Test_Suite SHALL resolve Vite path aliases (`@/` and `@assets/`) consistent with the store's `vite.config.ts`.
4. WHEN a component test is executed, THE Component_Test_Suite SHALL render the component with Tailwind CSS styles applied.

### Requirement 9: Test Isolation and Cleanup

**User Story:** As a developer, I want each integration test to run in isolation, so that test results are deterministic and not affected by other tests.

#### Acceptance Criteria

1. THE Integration_Test_Suite SHALL clean up any test data created during test execution (users, orders, cart items, coupons) after each test or test suite completes.
2. THE Integration_Test_Suite SHALL not depend on execution order between test files.
3. WHEN a test creates a user via the auth flow, THE Integration_Test_Suite SHALL delete that user during cleanup using the Supabase admin API.

### Requirement 10: TypeScript and ESM Compatibility

**User Story:** As a developer, I want the test infrastructure to use TypeScript and ESM natively, so that tests are consistent with the production codebase.

#### Acceptance Criteria

1. THE Test_Runner SHALL execute test files written in TypeScript without a separate compilation step.
2. THE Test_Runner SHALL support ESM `import`/`export` syntax in all test files.
3. THE Workspace_Config SHALL configure path alias resolution matching the monorepo's `tsconfig.json` paths.
