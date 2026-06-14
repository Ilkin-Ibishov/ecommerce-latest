# Requirements Document

## Introduction

This feature is a code-quality refactoring effort for the white-label e-commerce pnpm monorepo (`@workspace/store` React 19 SPA + `@workspace/api-server` Express 5 + Supabase). The work is derived from a full architecture audit captured in `docs/tasks/backlog.md` and addresses accumulated copy-paste and type-safety debt across the frontend, backend, and shared packages.

The defining constraint of this effort is **behavior preservation**. These are refactors, not feature changes. Every change MUST keep the application's observable behavior identical: API responses, HTTP status codes, UI rendering, and routing behavior remain unchanged, and the existing 700+ test suite continues to pass without modification. The one deliberate exception is the convergence of divergent duplicated logic onto an already-tested reference implementation (coupon math and cart merge), where the tested implementation is the authority for correct behavior.

Each requirement is scoped so it can ship independently without breaking the others, following the risk-adjusted sequencing in the backlog. Refactors are validated by the existing suite staying green plus new tests for any newly extracted shared module.

## Glossary

- **Store**: The `@workspace/store` package — the React 19 SPA serving storefront and admin UIs (`artifacts/store`).
- **API_Server**: The `@workspace/api-server` package — the Express 5 REST API (`artifacts/api-server`).
- **Observable_Behavior**: The externally visible outcomes of the system — API response bodies, HTTP status codes, rendered UI output, navigation/routing results, and side effects (audit log writes, stock changes) — as exercised by the existing test suite.
- **Existing_Test_Suite**: The current set of unit, property, integration, and E2E tests (700+ tests across vitest and Playwright) committed to the repository.
- **Shared_Types**: The generated types from `@workspace/db` (Drizzle schema + types) and `@workspace/api-zod` (Zod schemas + types from the OpenAPI spec).
- **Coupon_Calc**: The existing tested pure function module `artifacts/api-server/src/lib/coupon-calc.ts` exposing `calculateDiscount`.
- **Cart_Merge**: The existing tested pure function module `artifacts/api-server/src/lib/cart-merge.ts` exposing `mergeGuestCart`.
- **MAX_QUANTITY**: The per-line-item quantity cap enforced by `Cart_Merge`.
- **Auth_Middleware**: The Express middleware to be extracted: `requireAdmin` and `requireUser`.
- **Error_Handler**: The central Express 5 error-handling middleware to be added to `API_Server`.
- **Admin_List_Hook**: The `useAdminList` React hook to be extracted in `Store`.
- **Shared_Table_Components**: The extracted `DataTable`, `Pagination`, and `TableEmptyState` React components in `Store`.
- **Query_Layer**: The centralized `lib/queries/` data-access module in `Store` with reusable select fragments.
- **Translation_Util**: The single `getTranslatedField(translations, locale, field, fallback)` helper to be added to `Store`.
- **Audit_Helper**: The single `lib/audit.ts` helper in `API_Server` for audit-log writes.
- **Validate_Middleware**: The Zod-backed `validate()` request-validation middleware in `API_Server`.

## Requirements

### Requirement 1: Behavior Preservation (Global Invariant)

**User Story:** As a maintainer, I want every refactor to preserve observable behavior, so that I can adopt internal improvements without risking regressions in production.

#### Acceptance Criteria

1. WHEN any refactoring task in this spec is completed, THE Existing_Test_Suite SHALL pass with 100% of pre-existing tests passing (zero failed or errored) and with no edits to any pre-existing test assertion, input, or fixture.
2. WHEN a refactor changes the internal structure of a code path, THE Observable_Behavior of that code path (returned values, response payloads, HTTP status outcomes, persisted-state changes, emitted side effects, and user-visible output for identical inputs) SHALL remain identical to the pre-refactor behavior, except where Requirement 2 explicitly defines a convergence on the tested implementation.
3. IF a refactor causes any divergence in Observable_Behavior for an existing code path, THEN THE refactoring task SHALL be reverted to a state where the Existing_Test_Suite passes.
4. WHERE a refactor extracts a new shared module, hook, component, or utility, THE refactoring task SHALL include new tests covering each exported function with at least one nominal case and one error or boundary case.
5. THE refactoring effort SHALL be sequenced so that each requirement can be merged independently, with 100% of the Existing_Test_Suite passing immediately after each merge.
6. WHEN a refactor is applied to `API_Server` code, THE change SHALL conform, on every modified code path, to the Express 5 patterns, stock-change-via-RPC rule, `req.log` logging rule, and i18n `t()` rule defined in the project steering rules.

### Requirement 2: Wire In Tested Coupon and Cart-Merge Functions

**User Story:** As a developer, I want the existing tested pure functions for coupon discounts and cart merging to be used everywhere that logic runs, so that divergent inline reimplementations converge on correct, verified behavior.

#### Acceptance Criteria

1. THE API_Server SHALL use Coupon_Calc (`calculateDiscount`) for all coupon discount calculations in `routes/orders.ts` and `routes/coupons.ts`.
2. THE API_Server SHALL use Cart_Merge (`mergeGuestCart`) for all guest-cart merge logic in `routes/cart.ts`.
3. WHEN an order applies a coupon, THE API_Server SHALL produce a discount amount rounded to exactly 2 decimal places as defined by Coupon_Calc, correcting the prior divergence where `routes/orders.ts` skipped `Math.round`.
4. WHEN a computed discount exceeds the order subtotal, THE API_Server SHALL cap the discount at the subtotal as defined by Coupon_Calc.
5. IF a coupon's `min_order_amount` is set and the order subtotal is below it, THEN THE API_Server SHALL reject the coupon with an error indication and SHALL apply no discount.
6. WHEN a guest cart is merged, THE API_Server SHALL cap each merged line-item quantity at MAX_QUANTITY (99) as defined by Cart_Merge, correcting the prior divergence where cart paths omitted the cap.
7. WHEN the convergence is complete, THE API_Server SHALL contain zero inline reimplementations of coupon math or cart-merge logic in `routes/orders.ts`, `routes/coupons.ts`, and `routes/cart.ts`, delegating entirely to the shared functions.
8. THE existing tests for Coupon_Calc and Cart_Merge SHALL continue to pass with zero failures, and new tests SHALL cover the order, coupon, and cart endpoints that now consume these functions.

### Requirement 3: Extract Express Authentication Middleware

**User Story:** As a backend developer, I want reusable authentication middleware, so that the ~55 inline `requireAdmin` / user-token duplications are replaced by a single attachment point without changing access-control outcomes.

#### Acceptance Criteria

1. WHEN a request reaches a route guarded by the requireAdmin middleware and carries valid admin authorization, THE requireAdmin middleware SHALL attach an admin-context object to the request and pass control to the next handler.
2. WHEN a request reaches a route guarded by the requireUser middleware and carries a valid user token, THE requireUser middleware SHALL attach a user-context object to the request and pass control to the next handler.
3. IF a request reaching the requireAdmin middleware lacks valid admin authorization, THEN THE requireAdmin middleware SHALL respond with the identical HTTP status code and response body structure produced by the prior inline admin checks, indicate the authorization failure to the caller, and SHALL NOT pass control to the next handler.
4. IF a request reaching the requireUser middleware lacks a valid user token because the token is missing, malformed, or expired, THEN THE requireUser middleware SHALL respond with the identical HTTP status code and response body structure produced by the prior inline user-token checks, indicate the authentication failure to the caller, and SHALL NOT pass control to the next handler.
5. WHEN Auth_Middleware is adopted in a route, THE API_Server SHALL remove all inline authorization duplication from that route while producing the identical HTTP status code and response body structure as the pre-refactor route for both authorized and unauthorized requests.
6. WHEN the Auth_Middleware refactoring is complete, THE API_Server SHALL contain zero inline admin-authorization or user-token-authentication checks in route handlers outside the Auth_Middleware module.
7. THE Auth_Middleware SHALL be covered by tests that independently verify, for both requireAdmin and requireUser, at minimum one valid-credential case (control passes and context is attached), one invalid-credential case, and one missing-credential case.

### Requirement 4: Central Error Handler

**User Story:** As a backend developer, I want a central error-handling middleware, so that repetitive try/catch boilerplate is removed and internal error details stop leaking to clients.

#### Acceptance Criteria

1. THE API_Server SHALL register exactly one central Error_Handler middleware in `app.ts`, positioned after all route registrations, that receives errors auto-forwarded by Express 5.
2. WHEN an unhandled error reaches the Error_Handler, THE API_Server SHALL respond with HTTP status 500 and a response body containing only a generic error message field.
3. WHEN the Error_Handler builds the client response for an unhandled error, THE API_Server SHALL exclude `err.message`, `err.stack`, and any other internal error detail from the response body.
4. WHEN the Error_Handler processes an error, THE API_Server SHALL log the full error detail, including `err.message` and `err.stack`, using `req.log` before sending the response.
5. WHERE a route handler previously contained a try/catch block whose only behavior was returning an HTTP 500 response, THE redundant try/catch SHALL be removed and the error SHALL be auto-forwarded to the Error_Handler.
6. WHEN an error path that previously returned a specific non-500 status (for example 400 or 404) is refactored, THE API_Server SHALL preserve both the original HTTP status code and the original response body shape for that path.
7. THE Error_Handler SHALL be covered by new automated tests that assert the HTTP 500 status code, the presence of the generic message field, and the absence of `err.message` and `err.stack` in the response body.

### Requirement 5: Adopt Generated Shared Types

**User Story:** As a developer, I want domain data access to use the generated Shared_Types, so that the pervasive `as any` usage is eliminated incrementally without altering runtime behavior.

#### Acceptance Criteria

1. THE API_Server SHALL declare its Supabase client with the type `SupabaseClient<Database>`, where `Database` is imported from the generated Shared_Types, such that no instance of the Supabase client retains an `any` or untyped declaration.
2. WHERE a file accesses Supabase data through the casts `(supabase as any)`, `(req: any)`, or `.map((x: any) => ...)`, THE refactor SHALL replace every such cast in that file with the corresponding generated Shared_Types, leaving zero occurrences of those three cast forms in the converted file.
3. THE Shared_Types adoption SHALL convert exactly one file per change unit, such that each converted file is committed and mergeable independently of any other file's conversion.
4. WHEN a file is converted to use Shared_Types, THE converted file SHALL produce identical runtime inputs and outputs for all of its existing code paths, verified by all pre-existing unit, property, and E2E tests covering that file passing without modification to the tests.
5. WHEN a file conversion is applied, THE `pnpm run typecheck` command SHALL exit with success and report a type error count less than or equal to the count recorded immediately before that conversion.
6. IF a file conversion causes `pnpm run typecheck` to report any type error not present before the conversion, THEN THE refactor SHALL reject that conversion and restore the file to its pre-conversion state, leaving the type error count unchanged from the pre-conversion baseline.

### Requirement 6: Extract Admin List Hook and Shared Table Components

**User Story:** As a frontend developer, I want a shared admin-list hook and table components, so that the 7 duplicated admin list pages collapse onto common building blocks while rendering and pagination behave identically.

#### Acceptance Criteria

1. THE Store SHALL provide an Admin_List_Hook (`useAdminList`) encapsulating load, count, a boolean loading state, URL-driven pagination that syncs page number and page size to URL query parameters, and debounced search with a fixed 350 ms delay.
2. THE Store SHALL provide Shared_Table_Components (`DataTable`, `Pagination`, `TableEmptyState`).
3. WHEN an admin list page (Products, Orders, Users, Inventory, Coupons, Comments, Audit) is migrated to the Admin_List_Hook and Shared_Table_Components, THE page SHALL render identical rows, pagination controls, and empty state for the same data set, page number, and page size as before migration.
4. WHEN a migrated admin list page renders its search control, THE Store SHALL use the existing `SearchInput` component, replacing any bespoke search block that re-typed its internals.
5. WHEN a page-change, page-size-change, or search-change interaction occurs on a migrated page, THE Store SHALL produce the same URL state and result set as the pre-refactor implementation.
6. WHEN a migrated page's data set is empty, THE Store SHALL render the `TableEmptyState` and no data rows.
7. IF the data load for a migrated page fails, THEN THE Admin_List_Hook SHALL clear the loading state, preserve the prior result set, and surface an error indication.
8. THE Admin_List_Hook and Shared_Table_Components SHALL be covered by new tests asserting load/loading-state transitions, pagination URL sync, empty-state rendering, and error handling.

### Requirement 7: Centralize Supabase Queries Into a Data Layer

**User Story:** As a frontend developer, I want scattered raw Supabase queries centralized into a data layer, so that duplicated select shapes are defined once and reused without changing query results.

#### Acceptance Criteria

1. THE Store SHALL provide a Query_Layer (`lib/queries/`) containing reusable select fragments and typed wrapper functions such as `getProducts()`, `getCategoriesTree()`, and `getOrders()`.
2. WHEN a page is migrated to the Query_Layer, THE Store SHALL return the same data shape and contents that the prior inline query returned.
3. THE Query_Layer SHALL define the shared product select (`product_images + product_translations + product_categories`) once and reuse it across all callers that previously rebuilt it.
4. THE Query_Layer SHALL define the category-tree query once and reuse it across admin and storefront callers.
5. THE Query_Layer wrapper functions SHALL be covered by new tests verifying their returned shapes.

### Requirement 8: Single Translation-Picker Utility

**User Story:** As a frontend developer, I want one translation-picker utility, so that the ~20 reimplementations of selecting a localized field are replaced by a single helper with consistent fallback behavior.

#### Acceptance Criteria

1. THE Store SHALL provide a Translation_Util `getTranslatedField(translations, locale, field, fallback)` in `lib/utils.ts`.
2. THE Translation_Util SHALL support both the `lang_code` and `locale` key shapes present in existing call sites.
3. WHEN a translation for the requested locale exists, THE Translation_Util SHALL return that translation's requested field.
4. IF no translation matches the requested locale, THEN THE Translation_Util SHALL return the first available translation's field, and IF no translation exists THEN THE Translation_Util SHALL return the provided fallback.
5. WHEN a call site is migrated to the Translation_Util, THE displayed localized value SHALL match the value produced by the prior inline reimplementation for the same inputs.
6. THE Translation_Util SHALL be covered by new tests including locale-match, fallback-to-first, and fallback-to-default cases.

### Requirement 9: Split admin.ts by Domain

**User Story:** As a backend developer, I want the 648-line `admin.ts` split into per-domain route modules, so that admin code is maintainable while all admin endpoints keep their existing paths and behavior.

#### Acceptance Criteria

1. THE API_Server SHALL split `routes/admin.ts` into domain-specific modules under `routes/admin/` (for example products, coupons, banners, inventory, audit).
2. THE API_Server SHALL aggregate the domain modules through an `admin/index.ts` router.
3. WHEN the split is complete, THE API_Server SHALL expose the same admin endpoint paths, methods, request handling, and responses as before the split.
4. THE existing admin endpoint tests SHALL continue to pass without modification after the split.

### Requirement 10: Central Audit-Log Helper

**User Story:** As a backend developer, I want one audit-log helper, so that the ~25 duplicated audit writes across 3 inconsistent styles converge on a single API without losing any audit entries.

#### Acceptance Criteria

1. THE API_Server SHALL provide an Audit_Helper (`lib/audit.ts`) exposing one consistent fire-and-forget, logged-on-failure write API.
2. WHEN an admin write action that previously recorded an audit entry is migrated to the Audit_Helper, THE API_Server SHALL record an audit entry with equivalent content to the prior write.
3. IF an audit write fails, THEN THE Audit_Helper SHALL log the failure using `req.log` and SHALL NOT block or fail the originating request.
4. THE Audit_Helper SHALL be covered by new tests verifying entry content and failure handling.

### Requirement 11: Zod Validation Middleware on Admin Writes

**User Story:** As a backend developer, I want request validation on admin write endpoints, so that malformed input is rejected consistently without changing the behavior of valid requests.

#### Acceptance Criteria

1. THE API_Server SHALL provide a Validate_Middleware (`middlewares/validate.ts`) backed by Zod schemas.
2. WHERE an admin write endpoint (product, coupon, banner) previously lacked validation, THE Validate_Middleware SHALL validate the request body against its schema.
3. IF a validated request body fails schema validation, THEN THE API_Server SHALL respond with HTTP 400 and an error describing the validation failure.
4. WHEN a request body satisfies its schema, THE API_Server SHALL process the request with the same Observable_Behavior as before validation was added.
5. THE Validate_Middleware SHALL be covered by new tests verifying valid and invalid request handling.

### Requirement 12: Standardize Confirmation Dialog UX

**User Story:** As a frontend developer, I want all destructive actions to use the shared `ConfirmDialog`, so that confirmation UX is consistent and the copy-pasted `confirmState` object is removed.

#### Acceptance Criteria

1. THE Store SHALL route all destructive admin actions through the existing `ConfirmDialog` component.
2. WHERE a page previously used native `confirm()` or a hand-built modal (BannersPage, UsersPage, PagesPage), THE page SHALL be migrated to `ConfirmDialog`.
3. THE Store SHALL provide a `useConfirm()` hook that replaces the copy-pasted `confirmState` object.
4. WHEN a user confirms or cancels a destructive action on a migrated page, THE resulting action (proceed or abort) SHALL match the pre-refactor outcome.
5. THE `useConfirm()` hook SHALL be covered by new tests.

### Requirement 13: Split i18n Messages by Locale

**User Story:** As a frontend developer, I want the i18n messages split per locale with typed keys, so that translation typos are caught at compile time while existing translations resolve identically.

#### Acceptance Criteria

1. THE Store SHALL split `lib/i18n/messages.ts` into per-locale modules (`messages/az.ts`, `messages/ru.ts`, `messages/en.ts`) sharing a `MessageSchema` type.
2. THE Store SHALL derive a union key type so that `t()` accepts only valid message keys.
3. WHEN `t(key)` is called with an existing key for a given locale, THE Store SHALL return the same translated string that the prior single-file implementation returned.
4. THE existing i18n consistency tests SHALL continue to pass after the split.

### Requirement 14: Extract Storefront Product Grid and Sort Components

**User Story:** As a frontend developer, I want shared storefront grid, sort, and loading components, so that duplicated product-grid blocks collapse and hardcoded strings are removed without changing the storefront display.

#### Acceptance Criteria

1. THE Store SHALL extract a `ProductGrid` component and a `SortDropdown` component used by storefront pages.
2. WHEN ProductsPage, CategoryPage, SearchPage, and WishlistPage are migrated, THE Store SHALL render products using the existing `ProductCard` and route loading through the existing `ProductSkeletonGrid`.
3. THE Store SHALL move the hardcoded Azerbaijani strings in CategoryPage into `messages.ts` and render them via `t()`.
4. WHEN a storefront page is migrated, THE displayed products, sort options, and loading states SHALL match the pre-refactor display.
5. THE extracted `ProductGrid` and `SortDropdown` components SHALL be covered by new tests.

### Requirement 15: Decompose Oversized Files

**User Story:** As a developer, I want files exceeding 400 lines that mix responsibilities decomposed into focused modules, so that the code is maintainable while the composed UI and behavior remain unchanged.

#### Acceptance Criteria

1. THE Store SHALL extract inline modals, widgets, and sub-components out of `PageEditorPage`, `DashboardPage`, admin `ProductsPage`, `ProductDetail`, `Header`, and `ProfilePage` into their own files.
2. WHEN a file is decomposed, THE composed page SHALL render and behave identically to the pre-decomposition version.
3. THE existing tests covering the decomposed pages SHALL continue to pass without modification.

### Requirement 16: Shared Environment Util and Typed RPC Wrappers

**User Story:** As a developer, I want a shared environment-resolution utility and typed RPC wrappers, so that duplicated env normalization and untyped RPC calls are unified without changing resolved values or RPC behavior.

#### Acceptance Criteria

1. THE Store and API_Server SHALL share a single environment-resolution utility for the VITE→non-prefixed Supabase variable normalization currently duplicated across the store client, api-server, and test setup.
2. WHEN the shared env utility resolves a variable, THE resolved value SHALL match the value produced by the prior per-file resolution.
3. THE API_Server SHALL provide typed RPC wrapper functions (for example `decrementStockSafe()`, `incrementStock()`, `searchProducts()`) replacing `as any` RPC calls.
4. WHEN a typed RPC wrapper is invoked, THE underlying RPC call and its effect SHALL be identical to the prior untyped call, and stock changes SHALL continue to use the `decrement_stock_safe` / `increment_stock` RPCs.
5. THE shared env utility and typed RPC wrappers SHALL be covered by new tests.

### Requirement 17: Test Layout Consistency

**User Story:** As a developer, I want consistent test layout, so that store tests live in one place and disabled tests are resolved without losing coverage.

#### Acceptance Criteria

1. THE Store SHALL consolidate unit tests into one chosen location instead of splitting between `src/__tests__/` and `tests/`.
2. THE Store SHALL provide a `tests/helpers/` directory consistent with the API_Server helper structure.
3. WHEN test files are relocated, THE Existing_Test_Suite SHALL continue to pass and SHALL retain equivalent coverage.
4. WHERE vitest configs contain WIP exclusions for dead or disabled tests, THE refactor SHALL resolve each excluded test by either re-enabling or removing it.

### Requirement 18: Dead-Code Removal

**User Story:** As a developer, I want dead code removed, so that duplicate and unused definitions are eliminated without affecting any live behavior.

#### Acceptance Criteria

1. THE API_Server SHALL remove the duplicate dead `GET /profile/orders` definition in `cart.ts`, retaining the live definition.
2. THE Store SHALL remove the unused `BASE` constant in `lib/api.ts`.
3. THE Store SHALL provide a shared `userFetch` / `getAuthHeader` helper replacing the auth-header logic re-implemented in `useProfile.ts` and `WishlistPage.tsx`.
4. WHEN dead code is removed, THE Observable_Behavior of all live code paths SHALL remain unchanged and the Existing_Test_Suite SHALL continue to pass.
