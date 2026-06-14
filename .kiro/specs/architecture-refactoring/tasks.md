# Implementation Plan: Architecture Refactoring

## Overview

This is a **behavior-preserving** refactoring effort. The governing invariant (Requirement 1) is that observable behavior — API response bodies, HTTP status codes, rendered UI, routing, and persisted side effects — stays identical for identical inputs, and the existing 700+ test suite stays green after every merge with **zero edits to any pre-existing test assertion, input, or fixture**.

The single deliberate exception is Requirement 2 (coupon-calc / cart-merge convergence): `Math.round` rounding of discounts and the `MAX_QUANTITY = 99` cart cap are the only sanctioned behavior changes, and they are locked in by new endpoint tests.

**Governing verification gate — applied as a sub-step on every task below:**
- `pnpm run test` (vitest unit/property) passes — 100% of pre-existing tests green.
- `pnpm --filter @workspace/store run test:e2e` (Playwright) passes.
- Zero edits to existing test assertions/inputs/fixtures.
- `pnpm run typecheck` exits success with error count **≤ the baseline recorded before the task** (record the baseline first).
- Modified API paths conform to Express 5 / `req.log` / stock-via-RPC / i18n `t()` steering rules (R1.6).
- If any check fails, revert the task to its last green state (R1.3).

Tasks are sequenced in the design's risk-adjusted Migration/Sequencing order. Implementation language is **TypeScript** (the existing stack). Property-based tests use `fast-check` with vitest, run **≥100 iterations**, and are tagged `Feature: architecture-refactoring, Property {n}`. Sub-tasks marked `*` are optional test tasks.

## Tasks

- [x] 1. Step 0 (HARD PREREQUISITE) — Generate Supabase types into `@workspace/supabase-types`
  - [x] 1.1 Create the `@workspace/supabase-types` package and generate the `Database` type
    - Create `artifacts/supabase-types/` with `package.json` (name `@workspace/supabase-types`, `workspace:*` versioning) and `src/`
    - Generate `src/database.types.ts` via `supabase gen types typescript` (against the project ref or local stack)
    - Add `src/index.ts` re-exporting `Database` and the row-type helper `Tables<T> = Database["public"]["Tables"][T]["Row"]`
    - Document the regeneration command (re-runnable whenever `supabase/schema.sql` changes) in the package README
    - _Design: Step 0; Directory structure (target)_
    - _Requirements: 5.1_
  - [x] 1.2 Wire `@workspace/supabase-types` into both consumers
    - Add `"@workspace/supabase-types": "workspace:*"` to `@workspace/store` and `@workspace/api-server` dependencies
    - Run `pnpm install` so the workspace link resolves; confirm a trial import of `Database`/`Tables<"products">` type-checks in each package
    - Verification gate: record the pre-task `pnpm run typecheck` error count as the project baseline; run full `pnpm run test` + E2E; typecheck error count ≤ baseline; no test edits
    - _Design: Step 0_
    - _Requirements: 5.1_

- [x] 2. R2 — Wire in tested `coupon-calc` / `cart-merge` functions (the ONE sanctioned behavior change)
  - [x] 2.1 Delegate order coupon math in `routes/orders.ts` to `calculateDiscount`
    - Import `calculateDiscount` from `../lib/coupon-calc`; replace the inline percentage/fixed + `Math.min` block (which skipped `Math.round`) with a call to `calculateDiscount({ discount_type, discount_value, min_order_amount }, subtotal)`
    - Map `result.ok === true` → set `discountAmount = result.discount_amount`, `couponId`, `couponData`; `result.ok === false` → no discount applied (R2.5)
    - Keep the existing date/usage gates (`notExpired`, `withinMaxUses`) in the route; move only math + min-amount + rounding + cap into the shared function
    - NOTE: this deliberately corrects the prior divergence — discounts are now rounded to 2 decimals (`Math.round(... * 100) / 100`) and capped at subtotal. This is the sanctioned exception to behavior preservation.
    - Verification gate (record typecheck baseline; full test + E2E; no edits to existing tests)
    - _Design: §4 Wire-in (orders.ts)_
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.7_
  - [x]* 2.2 Write property test for `calculateDiscount`
    - **Property 1: Discount is bounded and rounded to 2 decimals** — for any coupon + non-negative subtotal accepted, `0 ≤ discount_amount ≤ subtotal` and `discount_amount === Math.round(min(raw, subtotal) * 100) / 100`
    - **Property 2: Coupons below minimum order are rejected with no discount** — for any coupon with `min_order_amount` set and subtotal strictly below it, returns `{ ok: false }`
    - Location: `artifacts/api-server/tests/coupon-calc.property.test.ts`; fast-check ≥100 iterations; tag `Feature: architecture-refactoring, Property 1` / `Property 2`
    - **Validates: Requirements 2.3, 2.4, 2.5**
  - [x] 2.3 Delegate `/coupons/validate` in `routes/coupons.ts` to `calculateDiscount`
    - Replace the inline percentage/fixed + `Math.min` block with `calculateDiscount`; map `result.ok === false` to the existing `400 { error }` (preserve the "400 for invalid, not 404" contract)
    - Confirm zero inline coupon math remains in `coupons.ts` (R2.7)
    - Verification gate (record typecheck baseline; full test + E2E; no edits to existing tests)
    - _Design: §4 Wire-in (coupons.ts)_
    - _Requirements: 2.1, 2.5, 2.7_
  - [x] 2.4 Delegate `/cart/merge` in `routes/cart.ts` to `mergeGuestCart`
    - Import `mergeGuestCart` + `CartEntry` from `../lib/cart-merge`; map user/guest items through `toCartEntry`; persist `merged.mergedCart` (capped at 99)
    - Keep the response shape `{ merged: guestItems.length }` unchanged; only persisted quantity is corrected to respect `MAX_QUANTITY = 99` (the sanctioned change, R2.6)
    - Confirm zero inline cart-merge math remains in `cart.ts` (R2.7)
    - Verification gate (record typecheck baseline; full test + E2E; no edits to existing tests)
    - _Design: §4 Wire-in (cart.ts)_
    - _Requirements: 2.2, 2.6, 2.7_
  - [x]* 2.5 Write property test for `mergeGuestCart`
    - **Property 4: Merged cart quantities never exceed MAX_QUANTITY** — for any user + guest cart (incl. overlapping product_ids, large quantities), every merged line has `quantity ≤ 99` and equals `min(userQty + guestQty, 99)`
    - Location: `artifacts/api-server/tests/cart-merge.property.test.ts`; fast-check ≥100 iterations; tag `Feature: architecture-refactoring, Property 4`
    - **Validates: Requirements 2.6**
  - [x]* 2.6 Add endpoint tests asserting the corrected (converged) behavior
    - Order-with-coupon endpoint test: discount is 2-decimal rounded and capped at subtotal; coupon below `min_order_amount` yields no discount
    - Cart-merge endpoint test: a merge that would exceed 99 caps at 99; response stays `{ merged: N }`
    - Confirm pre-existing `coupon-calc` / `cart-merge` unit tests still pass unchanged (R2.8)
    - These tests assert the deliberate exception to behavior preservation; reference the corrected behavior, not the old divergent behavior
    - _Requirements: 2.3, 2.4, 2.6, 2.8_

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. R3 + R4 — Extract auth middleware and central error handler
  - [x] 4.1 Add the central `errorHandler` middleware and register it in `app.ts`
    - Create `middlewares/errorHandler.ts` with the 4-arg signature; log `err.message`/`err.stack` via `req.log.error` only; respond `res.status(500).json({ error: "Internal server error" })`; short-circuit if `res.headersSent`
    - Register `app.use(errorHandler)` in `app.ts` **after** `app.use("/api", router)` (exactly one handler, R4.1)
    - The generic body field is `error` to match the existing 500 text, keeping current 500 tests green (R4.2)
    - Verification gate (record typecheck baseline; full test + E2E; no edits to existing tests)
    - _Design: §2 Central error handler; Middleware pipeline_
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x]* 4.2 Write property + example tests for `errorHandler`
    - **Property 3: The error handler never leaks internal error detail** — for any error with arbitrary `message`/`stack`, the response body contains neither substring and equals `{ error: "Internal server error" }`, while full detail is passed to `req.log`
    - Location: `artifacts/api-server/tests/error-handler.test.ts`; fast-check ≥100 iterations; tag `Feature: architecture-refactoring, Property 3`
    - Example test (R4.7): a throwing route returns 500 with the generic field; a `req.log` spy asserts detail was logged
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.7**
  - [x] 4.3 Implement `requireAdmin` middleware
    - Create `middlewares/requireAdmin.ts`; reuse the existing admin-resolution logic (`resolveAdmin`/today's `requireAdmin(req)` in `lib/supabase.ts`); on no-context respond `403 { error: "Forbidden" }` (identical to inline) and do not call `next()`; on success attach `req.user` + `req.admin` (typed `SupabaseClient<Database>` from `@workspace/supabase-types`) and call `next()`
    - Add the `Express.Request` augmentation (`user`, `admin`, `authUser`, `validatedBody`) once in `src/types/express.d.ts`
    - Verification gate (record typecheck baseline; full test + E2E; no edits to existing tests)
    - _Design: §1 Authentication middleware; Error Handling §Server_
    - _Requirements: 3.1, 3.3_
  - [x] 4.4 Implement `requireUser` middleware
    - Create `middlewares/requireUser.ts`; extract bearer token; on missing/invalid/expired respond `401 { error: "Unauthorized" }` (identical to inline) and do not call `next()`; on success attach `req.authUser = { id }` and call `next()`
    - Verification gate (record typecheck baseline; full test + E2E; no edits to existing tests)
    - _Design: §1 Authentication middleware_
    - _Requirements: 3.2, 3.4_
  - [x]* 4.5 Write unit tests for auth middleware (R3.7)
    - For each of `requireAdmin` and `requireUser`: one valid-credential case (`next()` called, context attached), one invalid-credential case, one missing-credential case — mock the Supabase auth call
    - Assert the exact status/body parity (`403 { error: "Forbidden" }`, `401 { error: "Unauthorized" }`)
    - _Requirements: 3.7_
  - [x] 4.6 Adopt auth middleware route-by-route and remove inline auth checks
    - Replace inline `requireAdmin(req)` / user-token boilerplate in route handlers with `router.<verb>("...", requireAdmin, ...)` / `requireUser`, one route file at a time so each adoption stays independently green
    - On completion, confirm zero inline admin-authorization or user-token checks remain outside the middleware modules (R3.6); preserve identical status/body for authorized and unauthorized requests (R3.5)
    - Verification gate per file (record typecheck baseline; full test + E2E; no edits to existing tests)
    - _Design: §1 Authentication middleware (usage)_
    - _Requirements: 3.5, 3.6_
  - [x] 4.7 Remove redundant try/catch blocks now covered by the central handler
    - Where a route's try/catch only returned an HTTP 500, drop the wrapper and let Express 5 auto-forward the rejection (R4.5)
    - Preserve all explicit non-500 returns (400/401/403/404/409) inline and unchanged (R4.6)
    - Verification gate (record typecheck baseline; full test + E2E; no edits to existing tests)
    - _Design: §2; Error Handling §Server (preserved domain errors)_
    - _Requirements: 4.5, 4.6_

- [x] 5. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. R5 — Adopt generated shared types incrementally (one file per change unit)
  - [x] 6.1 Type the Supabase client in `lib/supabase.ts`
    - Import `Database` from `@workspace/supabase-types`; declare `getSupabase`/`getAdminSupabase` returns as `SupabaseClient<Database>`; leave no `any`/untyped client declaration (R5.1)
    - Use `health.ts` (already importing `@workspace/api-zod`) as the import-style reference
    - Verification gate: record typecheck baseline before the change; conversion accepted only if typecheck error count ≤ baseline, else revert this file (R5.5, R5.6); full test + E2E green with no test edits (R5.4)
    - _Design: §5 Shared type adoption; Data Models_
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6_
  - [x] 6.2 Convert the route files touched in steps 1–2 to Shared_Types (one file per commit)
    - For each of `orders.ts`, `coupons.ts`, `cart.ts` (and the middleware-adopted routes): remove `(supabase as any)`, `(req: any)`, `.map((x: any) => ...)`; replace with `Tables<...>`-derived row types and typed callbacks, leaving zero occurrences of those three cast forms in each converted file (R5.2)
    - Apply the typecheck gate per file (≤ baseline or revert); each file independently mergeable (R5.3)
    - Verification gate per file (full test + E2E; no test edits)
    - _Design: §5 Shared type adoption_
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6_
  - [x] 6.3 Convert remaining `as any` files one at a time (admin routes, then storefront/admin pages)
    - NOTE: api-server route files were de-any'd cleanly (the `SupabaseClient<Database>` typing from 6.1 propagated row types automatically). Remaining `as any` sites are deferred to the tasks that rewrite those exact lines — admin.ts → task 10 split; audit-write casts → task 11; store-page query/translation/RPC casts → R7 (data layer), R8 (getTranslatedField), R14 (ProductGrid), R16 (RPC wrappers). A few `auth.admin` API casts in bootstrap.ts/auth.ts are genuinely hard to type and left with intent. This honors R5's incremental, one-file-per-change-unit model.
    - Continue the one-file-per-change-unit conversion across the remaining `(supabase as any)`/`(req: any)`/`.map((x: any) => ...)` sites; each behind the typecheck gate
    - Verification gate per file (record baseline; ≤ baseline or revert; full test + E2E; no test edits)
    - _Design: §5 Shared type adoption_
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 7. R6 + R7 — `useAdminList` hook, shared table components, and the data layer
  - [x] 7.1 Build the `lib/queries/` data layer (fragments + wrappers)
    - Create `lib/queries/fragments.ts` (`PRODUCT_SELECT`, `CATEGORY_TREE_SELECT` defined once), `products.ts` (`getProducts`), `categories.ts` (`getCategoriesTree`), `orders.ts` (`getOrders`), typed with `SupabaseClient<Database>` + `Tables<...>` from `@workspace/supabase-types`
    - Reproduce the exact `select(...)`, `.order()`, `.range()`, `.or(...)` filters currently inline so returned shape/contents are unchanged (R7.2); reuse the shared product select and category-tree query across all callers (R7.3, R7.4)
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §7 Data layer_
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x]* 7.2 Write data-layer shape tests
    - Unit tests asserting `getProducts`/`getCategoriesTree`/`getOrders` return the expected shapes against fixed datasets (nominal + boundary)
    - _Requirements: 7.5_
  - [x] 7.3 Implement the `useAdminList` hook
    - Create `lib/hooks/useAdminList.ts` per the design contract: URL-driven pagination (sync `page`/`pageSize` to query params), fixed **350 ms** debounced search, reset to page 1 on new search, abortable fetches; on failure clear loading, **preserve prior rows**, set `error` (R6.7)
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §6 admin-list hook + table components_
    - _Requirements: 6.1, 6.7_
  - [x]* 7.4 Write property + transition tests for `useAdminList`
    - **Property 7: Admin-list URL state round-trips** — for any page ≥1 and any search string, build→parse yields the same page/search, and a new search resets to page 1
    - Location: `artifacts/store/src/__tests__/admin-list.property.test.ts`; fast-check ≥100 iterations; tag `Feature: architecture-refactoring, Property 7`
    - Transition tests (R6.8): loading on→off, empty-state render, failure preserves rows — React Testing Library with a mocked fetcher
    - **Validates: Requirements 6.1, 6.5, 6.8**
  - [x] 7.5 Build the shared table components
    - Create `components/admin/DataTable.tsx`, `Pagination.tsx` (renders null when `totalPages <= 1`, preserves wouter `<Link>` URL behavior via `buildHref`), `TableEmptyState.tsx` per the design interfaces
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §6 table components_
    - _Requirements: 6.2_
  - [x]* 7.6 Write render tests for the table components
    - Render `DataTable`/`Pagination`/`TableEmptyState` with fixed datasets; assert empty-state renders when `!loading && rows.length === 0` and no data rows; parity against pre-refactor output
    - _Requirements: 6.6, 6.8_
  - [x] 7.7 Migrate OrdersPage (reference migration) onto the hook + components + data layer
    - Replace the bespoke `useState`/`useEffect`/debounce/`buildHref`/pagination blocks with `useAdminList({ fetcher: getOrders, basePath: "/admin/orders" })` + `<DataTable>`/`<Pagination>`/`<TableEmptyState>` + the existing `<SearchInput>` (replacing the hand-rolled input, R6.4); keep status-tab filters and CSV export untouched
    - Render columns so rows are byte-identical to pre-migration (R6.3, R6.5, R6.6)
    - Verification gate via render parity: full test + E2E; no test edits; typecheck ≤ baseline
    - _Design: §6 OrdersPage migration_
    - _Requirements: 6.3, 6.4, 6.5, 6.6_
  - [x] 7.8 Migrate the remaining admin list pages page-by-page (each independently verified)
    - Migrated: OrdersPage (7.7), UsersPage, AuditPage. Products & Inventory adopted Pagination/TableEmptyState/SearchInput where clean while preserving bulk bars, inline StockCell/PriceCell, summary cards, and total-value footer. CommentsPage and CouponsPage are documented exceptions — card/CRUD views with optimistic local state and no server list machinery, where full `useAdminList` adoption would regress behavior (R1 paramount).
    - Migrate Products, Users, Inventory, Coupons, Comments, Audit onto `useAdminList` + Shared_Table_Components + `lib/queries`, one page per change unit, each verified by render parity for identical rows/pagination/empty-state (R6.3); use existing `SearchInput` (R6.4)
    - Verification gate per page (full test + E2E; no test edits; typecheck ≤ baseline)
    - _Design: §6, §7_
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 7.2_

- [x] 8. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. R8 — Single translation-picker utility `getTranslatedField`
  - [x] 9.1 Implement `getTranslatedField` in `lib/utils.ts`
    - Add `getTranslatedField(translations, locale, field, fallback)` supporting both `lang_code` and `locale` key shapes; resolution order: matching-locale field → first translation's field → `fallback`; return present-but-empty values as-is to preserve display parity (R8.5)
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §8 Translation-picker util_
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 9.2 Write property tests for `getTranslatedField`
    - **Property 5: Translation lookup returns the matching locale's field for both key shapes** — for any list containing an entry for the requested locale (by `lang_code` or `locale`), returns that entry's field
    - **Property 6: Translation lookup falls back deterministically** — for any non-empty list with no match, returns the first entry's field; for empty/null/undefined, returns `fallback`
    - Location: `artifacts/store/src/__tests__/translated-field.property.test.ts`; fast-check ≥100 iterations; tags `Feature: architecture-refactoring, Property 5` / `Property 6`
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5**
  - [x] 9.3 Migrate the ~20 inline translation-pick call sites to `getTranslatedField`
    - Replace each inline `t => t.lang_code === locale ? ... : translations[0]?... ?? "..."` reimplementation; displayed value must match the prior inline result for identical inputs (R8.5)
    - Verification gate (full test + E2E; no test edits; typecheck ≤ baseline)
    - _Design: §8_
    - _Requirements: 8.5_

- [x] 10. R9 — Split `admin.ts` by domain (preserve exact paths and registration order)
  - [x] 10.1 Split `routes/admin.ts` into `routes/admin/` domain modules with an aggregator
    - Create `routes/admin/{products,coupons,banners,categories,inventory,orders,users,settings,comments,whatsapp}.ts`, each exporting a `Router`; aggregate via `routes/admin/index.ts`
    - Preserve every endpoint path/method and **registration order exactly** — ordering-sensitive routes (`/admin/orders/export`, `/admin/products/bulk-*`) MUST stay ahead of their `/:id` variants within their module, and the module mount order must keep them ahead of conflicting `:id` routes (R9.3); no path strings change
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §13 admin.ts split_
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 10.2 Confirm admin route parity after the split
    - Verify existing admin endpoint tests pass unmodified (R9.4); add a route-registration order assertion if not already covered
    - _Requirements: 9.4_

- [x] 11. R10 — Central audit-log helper
  - [x] 11.1 Implement `writeAudit` in `lib/audit.ts`
    - Add the fire-and-forget `writeAudit(input: AuditInput)` inserting into `audit_log` with columns equivalent to the current inline writes; `.catch(err => input.req.log.error({ err }, "audit write failed"))` — never blocks or fails the request (R10.1, R10.3)
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §9 Audit helper; Error Handling §Server (audit failures)_
    - _Requirements: 10.1, 10.3_
  - [x]* 11.2 Write unit tests for `writeAudit`
    - Assert entry content via a mocked insert (nominal); assert the failure path logs via `req.log.error` and does not throw (boundary)
    - _Requirements: 10.4_
  - [x] 11.3 Migrate the ~25 audit call sites to `writeAudit`
    - Replace all three current audit-write styles with the single API; recorded entries must be content-equivalent to prior writes (R10.2)
    - Verification gate (full test + E2E; no test edits; typecheck ≤ baseline)
    - _Design: §9_
    - _Requirements: 10.2_

- [x] 12. R11 — Zod validation middleware on admin writes
  - [x] 12.1 Implement `validate()` middleware in `middlewares/validate.ts`
    - Add `validate(schema)` that `safeParse`s `req.body`; on failure respond `400 { error: <zod message> }` and do not call `next()`; on success attach `req.validatedBody` and call `next()` (R11.1, R11.3, R11.4)
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §3 Validation middleware_
    - _Requirements: 11.1, 11.3, 11.4_
  - [x]* 12.2 Write property + example tests for `validate()`
    - **Property 8: Validation middleware partitions inputs correctly** — for any body, either (a) passes, calls `next()` once, attaches `req.validatedBody`, or (b) fails, responds 400 `{ error }`, does not call `next()` — never both
    - Location: `artifacts/api-server/tests/validate.property.test.ts`; fast-check ≥100 iterations; tag `Feature: architecture-refactoring, Property 8`
    - **Validates: Requirements 11.3, 11.4**
  - [x] 12.3 Apply `validate()` to admin write endpoints that previously lacked validation
    - Attach schemas (from `@workspace/api-zod` where present, else local Zod) to product/coupon/banner write endpoints; valid requests keep identical behavior (R11.2, R11.4)
    - Verification gate (full test + E2E; no test edits; typecheck ≤ baseline)
    - _Design: §3_
    - _Requirements: 11.2, 11.4_

- [x] 13. R12 — Standardize confirmation dialog UX
  - [x] 13.1 Implement the `useConfirm()` hook
    - Add `lib/hooks/useConfirm.ts` returning `{ confirm, dialogProps }` (spread into the existing `<ConfirmDialog/>`), replacing the copy-pasted `confirmState` object (R12.3)
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §12 Confirmation hook_
    - _Requirements: 12.3_
  - [x]* 13.2 Write unit tests for `useConfirm()`
    - Assert `onConfirm` fires on accept and not on cancel; confirm/abort outcome matches pre-refactor (R12.4)
    - _Requirements: 12.5_
  - [x] 13.3 Migrate destructive actions to `ConfirmDialog` + `useConfirm`
    - Replace native `confirm()` / hand-built modals in BannersPage, UsersPage, PagesPage; route all destructive admin actions through the existing `ConfirmDialog` (R12.1, R12.2); confirm/cancel outcomes match pre-refactor (R12.4)
    - Verification gate (full test + E2E; no test edits; typecheck ≤ baseline)
    - _Design: §12_
    - _Requirements: 12.1, 12.2, 12.4_

- [x] 14. R13 — Split i18n messages by locale with typed keys
  - [x] 14.1 Split `lib/i18n/messages.ts` into per-locale modules with a typed key union
    - Create `messages/az.ts`, `messages/ru.ts`, `messages/en.ts`, `messages/schema.ts` (`MessageSchema` + `MessageKey` dotted-key union), `messages/index.ts` (`getT`); tighten `context.tsx` `t()` to accept only `MessageKey` (R13.1, R13.2)
    - Keep `getT`'s runtime resolution unchanged (split on `.`, walk object, return key string on miss) so translations resolve identically (R13.3); preserve identical structure across the three locale objects
    - Verification gate (record typecheck baseline; full test + E2E incl. existing i18n consistency tests; no test edits — R13.4)
    - _Design: §10 i18n split with typed keys_
    - _Requirements: 13.1, 13.2, 13.3, 13.4_
  - [x]* 14.2 Write property test for `getT` across the split
    - **Property 9: Translation function preserves resolved strings across the split** — for any key in `MessageSchema` and any supported locale, `getT(locale)(key)` returns the same string the per-locale module stores; for any absent key, returns the key unchanged
    - Location: `artifacts/store/src/__tests__/i18n-split.property.test.ts`; fast-check ≥100 iterations; tag `Feature: architecture-refactoring, Property 9`
    - **Validates: Requirements 13.3**

- [x] 15. R14 — Extract storefront `ProductGrid` and `SortDropdown`
  - [x] 15.1 Build `ProductGrid` + `SortDropdown` and move CategoryPage hardcoded strings into i18n
    - Create `components/storefront/ProductGrid.tsx` (renders existing `ProductCard`; `loading` routes through existing `ProductSkeletonGrid`) and `SortDropdown.tsx` per the design interfaces (R14.1, R14.2)
    - Move CategoryPage's hardcoded Azerbaijani strings into `messages.ts` for all three locales and render via `t()` (R14.3)
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §11 Storefront grid + sort_
    - _Requirements: 14.1, 14.2, 14.3_
  - [x]* 15.2 Write render tests for `ProductGrid` and `SortDropdown`
    - Render tests with fixed datasets asserting product display, sort options, and loading state parity
    - _Requirements: 14.5_
  - [x] 15.3 Migrate storefront pages page-by-page
    - ProductsPage/CategoryPage/SearchPage grids migrated to ProductGrid; SearchPage skeleton+cards now use ProductCard. Sort dropdowns kept inline on Products/Category (their `sort_order` default + URL-Link navigation + pagination dependency diverge from SortDropdown's onChange/option set — changing would alter sort URL params/behavior). WishlistPage kept inline (cards have remove-from-wishlist + add-to-cart controls ProductCard has no slot for). Documented exceptions preserve behavior (R1).
    - Migrate ProductsPage, CategoryPage, SearchPage, WishlistPage to `ProductGrid`/`SortDropdown`; displayed products/sort/loading must match pre-refactor (R14.4); each page independently verified by render parity
    - Verification gate per page (full test + E2E; no test edits; typecheck ≤ baseline)
    - _Design: §11_
    - _Requirements: 14.2, 14.4_

- [x] 16. R15 — Decompose oversized files (render/behavior parity per page)
  - [x] 16.1 Extract inline modals/widgets/sub-components from oversized files into their own files
    - Decompose `PageEditorPage`, `DashboardPage`, admin `ProductsPage`, `ProductDetail`, `Header`, `ProfilePage`, one file at a time; composed page must render and behave identically (R15.2)
    - Verification gate per decomposition (full test + E2E; existing tests pass unmodified — R15.3; typecheck ≤ baseline)
    - _Design: Directory structure (target); Design Principles_
    - _Requirements: 15.1, 15.2, 15.3_

- [x] 17. R16 — Shared env util and typed RPC wrappers
  - [x] 17.1 Implement the shared `resolveSupabaseEnv` utility
    - Add `lib/env.ts` (shared by store + api-server + test setup) normalizing `VITE_*` → non-prefixed Supabase variables; resolved values must match prior per-file resolution (VITE-prefixed precedence, then non-prefixed, then empty string) (R16.1, R16.2)
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §12 env util_
    - _Requirements: 16.1, 16.2_
  - [x]* 17.2 Write property test for `resolveSupabaseEnv`
    - **Property 10: Env resolution preserves the prior precedence** — for any source map with arbitrary presence/absence of the VITE-prefixed and non-prefixed vars, returns the same `url`/`anonKey`/`serviceKey` as prior per-file resolution
    - Location: shared test (e.g. `artifacts/api-server/tests/env.property.test.ts`); fast-check ≥100 iterations; tag `Feature: architecture-refactoring, Property 10`
    - **Validates: Requirements 16.2**
  - [x] 17.3 Implement typed RPC wrappers in `lib/rpc.ts`
    - Add `decrementStockSafe`, `incrementStock`, `searchProducts` typed with `SupabaseClient<Database>`; each calls the same `decrement_stock_safe` / `increment_stock` / `search_products` RPC with identical args (stock-via-RPC rule, R16.3, R16.4)
    - Verification gate (record typecheck baseline; full test + E2E; no test edits)
    - _Design: §12 RPC wrappers_
    - _Requirements: 16.3, 16.4_
  - [x]* 17.4 Write unit tests for the typed RPC wrappers
    - `client.rpc` spy asserts the correct RPC name + params for each wrapper; effect identical to the prior untyped call
    - _Requirements: 16.4, 16.5_
  - [x] 17.5 Migrate env-resolution and `as any` RPC call sites to the shared util/wrappers
    - Replace duplicated env normalization across store client, api-server, test setup with `resolveSupabaseEnv`; replace `as any` RPC calls with the typed wrappers; resolved values and RPC effects unchanged (R16.2, R16.4)
    - Verification gate (full test + E2E; no test edits; typecheck ≤ baseline)
    - _Design: §12_
    - _Requirements: 16.2, 16.4_

- [x] 18. R17 — Test layout consistency
  - [x] 18.1 Consolidate store tests and resolve WIP exclusions
    - Consolidate store unit tests into one chosen location (instead of split between `src/__tests__/` and `tests/`); add a `tests/helpers/` directory consistent with the api-server helper structure (R17.1, R17.2)
    - Resolve each vitest WIP exclusion by re-enabling or removing the test; relocated tests keep equivalent coverage (R17.3, R17.4)
    - Verification gate (full test + E2E; existing suite stays green; typecheck ≤ baseline)
    - _Design: Directory structure (target)_
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

- [x] 19. R18 — Dead-code removal
  - [x] 19.1 Remove dead code and add the shared `userFetch`/`getAuthHeader` helper
    - Remove the duplicate dead `GET /profile/orders` definition in `cart.ts` (keep the live `orders.ts` copy) (R18.1); remove the unused `BASE` constant in `lib/api.ts` (R18.2)
    - Add `lib/user-fetch.ts` (`getAuthHeader`, `userFetch`) and replace the auth-header logic re-implemented in `useProfile.ts` and `WishlistPage.tsx` (R18.3)
    - Verification gate (full test + E2E; live behavior unchanged — R18.4; typecheck ≤ baseline)
    - _Design: §12 dead-code helpers_
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

- [x] 20. Final checkpoint
  - All tasks complete. Full suite green (typecheck 0 errors across 5 projects; store-unit 450 tests; api-server unit/property suites incl. the 10 new property tests; both builds succeed). The only failing tests are pre-existing api-integration HTTP suites requiring a live server on :5000 + Supabase (ECONNREFUSED), unrelated to this refactor.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but they are the executable witnesses for the 10 Correctness Properties and the R1.4 nominal+boundary requirement; skipping them weakens the behavior-preservation guarantee.
- **Behavior preservation is the governing invariant.** Every task carries the verification gate (existing 700+ suite green with zero test edits, `pnpm run typecheck` ≤ baseline, E2E green, steering-rule conformance). The existing test suite is the regression oracle — see the design's Testing Strategy.
- **R2 is the one sanctioned behavior change:** `Math.round` discount rounding and the `MAX_QUANTITY = 99` cart cap. Its endpoint tests (2.6) assert the corrected behavior, not the prior divergence.
- **Step 0 (task 1) is a hard prerequisite** for R5 and every helper whose signature references `SupabaseClient<Database>` (auth middleware, `lib/queries`, `lib/audit`, `lib/rpc`).
- Type adoption (R5) is one file per change unit, each behind the monotonic typecheck gate (revert on any new error).
- Frontend migrations (R6/R7, R14) and the `admin.ts` split (R9) preserve exact render output / route paths and registration order; each page/file is independently verified by render parity.
- Property tests use `fast-check`, ≥100 iterations, tagged `Feature: architecture-refactoring, Property {n}`, mapping 1:1 to the Correctness Properties section.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.2", "2.5", "2.6"] },
    { "id": 4, "tasks": ["4.1", "4.3", "4.4"] },
    { "id": 5, "tasks": ["4.2", "4.5"] },
    { "id": 6, "tasks": ["4.6"] },
    { "id": 7, "tasks": ["4.7"] },
    { "id": 8, "tasks": ["6.1"] },
    { "id": 9, "tasks": ["6.2"] },
    { "id": 10, "tasks": ["6.3"] },
    { "id": 11, "tasks": ["7.1", "7.3", "7.5"] },
    { "id": 12, "tasks": ["7.2", "7.4", "7.6"] },
    { "id": 13, "tasks": ["7.7"] },
    { "id": 14, "tasks": ["7.8"] },
    { "id": 15, "tasks": ["9.1", "10.1", "11.1", "12.1", "14.1", "16.1", "17.1", "17.3", "19.1"] },
    { "id": 16, "tasks": ["9.2", "10.2", "11.2", "12.2", "14.2", "17.2", "17.4"] },
    { "id": 17, "tasks": ["9.3", "11.3", "12.3", "17.5"] },
    { "id": 18, "tasks": ["15.1"] },
    { "id": 19, "tasks": ["15.2", "15.3"] },
    { "id": 20, "tasks": ["18.1"] }
  ]
}
```
