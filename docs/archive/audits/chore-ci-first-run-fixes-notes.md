# Chore CI First Run Fixes — Implementation Notes

**Date:** 2026-11-06  
**Branch:** `chore/ci-first-run-fixes`

---

## 1. Overview

The `integration-e2e` CI job ran against a real Supabase project (`ecommerce-warehouse`, ref `jcvsnoiacrknzejouxah`) for the first time, passing 1119 of 1146 tests with 8 failures across 6 files. All 5 prescriptive chore items diagnosed from the CI log have been implemented on dedicated commits following repository conventions and AGENTS.md rules.

---

## 2. Changes per Item

### Item 1 — `comments.rating` column migration and schema mirror
- **Files:**
  - `supabase/migrations/20261106100000_add_comments_rating_column.sql` (new)
  - `supabase/schema.sql`
- **Problem:** `artifacts/api-server/src/routes/comments.ts` reads and writes `comments.rating` (lines 13, 24, 26, 38; integer 1–5, optional). Neither an existing migration nor `supabase/schema.sql` created this column. Consequently, tests in `sec002-004-p1.exploration.test.ts` and `sec002-004-rls.integration.test.ts` failed with Postgres error `PGRST204: Could not find the 'rating' column of 'comments' in the schema cache`.
- **Change:**
  - Added migration `supabase/migrations/20261106100000_add_comments_rating_column.sql`:
    ```sql
    ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS rating integer CHECK (rating >= 1 AND rating <= 5);
    ```
  - Mirrored `rating integer check (rating >= 1 and rating <= 5),` into `supabase/schema.sql` inside the `public.comments` table definition.
- **Migration Application Status:** Written and tracked in version control, but **unapplied** to remote Supabase project (no remote database was touched; no credentials were acquired).
- **Commit:** `7ce5dfb fix(db): add comments.rating column and mirror to schema.sql`

---

### Item 2 — `admin-routes.test.ts` stale `EXPECTED_ROUTES`
- **File:** `artifacts/api-server/tests/admin-routes.test.ts`
- **Problem:** `EXPECTED_ROUTES` was frozen at task 10.2 (R9.4) ending at `DELETE /admin/comments/:id`. When M2a (suppliers, receipts, receipt lines, margins), M2b (stocktakes, stocktake lines), and M2c (reservations) routes were added to `artifacts/api-server/src/routes/admin/index.ts`, `EXPECTED_ROUTES` was not updated. Both router parity tests (`registers every expected admin route exactly once` and `preserves the full registration order`) failed.
- **Change:**
  - Appended the 35 missing admin routes in their exact Express router registration order following `DELETE /admin/comments/:id`:
    - `// suppliers.ts`: `GET /admin/suppliers`, `GET /admin/suppliers/:id`, `POST /admin/suppliers`, `PATCH /admin/suppliers/:id`, `DELETE /admin/suppliers/:id`
    - `// receipts.ts`: `GET /admin/receipts`, `POST /admin/receipts`, `GET /admin/receipts/:id`, `PATCH /admin/receipts/:id`, `DELETE /admin/receipts/:id`, `POST /admin/receipts/:id/post`, `POST /admin/receipts/:id/reverse`
    - `// receipt-lines.ts`: `POST /admin/receipts/:id/lines`, `PATCH /admin/receipts/:id/lines/:lineId`, `DELETE /admin/receipts/:id/lines/:lineId`
    - `// margins.ts`: `GET /admin/reports/margins,/admin/margins`
    - `// stocktakes.ts`: `GET /admin/stocktakes`, `POST /admin/stocktakes`, `GET /admin/stocktakes/:id`, `PATCH /admin/stocktakes/:id`, `DELETE /admin/stocktakes/:id`, `GET /admin/stocktakes/:id/variance`, `POST /admin/stocktakes/:id/resolve`, `POST /admin/stocktakes/:id/opening-costs`, `POST /admin/stocktakes/:id/post`
    - `// stocktake-lines.ts`: `POST /admin/stocktakes/:id/lines`, `PATCH /admin/stocktakes/:id/lines/:lineId`, `DELETE /admin/stocktakes/:id/lines/:lineId`
    - `// reservations.ts`: `GET /admin/reservations`, `GET /admin/reservations/aged`, `POST /admin/reservations`, `POST /admin/reservations/:id/payment`, `POST /admin/reservations/:id/fulfil`, `POST /admin/reservations/:id/release`, `PATCH /admin/reservations/:id/price`
  - Neither test assertion was weakened; order-sensitive checks remain strictly enforced.
- **Commit:** `98d9695 test(admin): update EXPECTED_ROUTES in admin-routes.test.ts with M2 routes`

---

### Item 3 — `goods-receipts-post-route.integration.test.ts` argument order bug
- **File:** `artifacts/api-server/tests/goods-receipts-post-route.integration.test.ts`
- **Problem:** Line 37 called `loginTestUser(adminPhone, "admin")`. `loginTestUser` has signature `(baseUrl: string, phone: string)`. Passing `adminPhone` as the first argument caused `TypeError: Failed to parse URL from +994505305664/api/dev/mock-otp`.
- **Change:**
  - Added `const BASE_URL = process.env.API_URL || "http://localhost:5000";` matching the rest of the test suite.
  - Changed the call to `loginTestUser(BASE_URL, adminPhone)`.
- **Commit:** `31c79de test(receipts): fix loginTestUser argument order and add BASE_URL in goods-receipts-post-route.integration.test.ts`

---

### Item 4 — Self-sufficient test fixtures for categories and coupons
- **Files:**
  - `artifacts/api-server/tests/sec002-004-p1.exploration.test.ts`
  - `artifacts/api-server/tests/sec002-004-rls.integration.test.ts`
  - `artifacts/api-server/tests/sec002-sec003-sec004-preservation.test.ts`
- **Problem:** Tests assumed hand-created fixture rows on the remote database. Fresh databases lacked enough categories (>=3 for P1 exploration, >=4 for RLS integration) and lacked the `WELCOME10` coupon row expected by preservation tests `[3.9]` and `[3.3]`.
- **Exact Fixture Data Created & Cleanup:**
  1. `sec002-004-p1.exploration.test.ts`:
     - Queries `categories` with limit(3).
     - If fewer than 3 exist, creates missing rows via `admin.from("categories").insert({ slug: `test-cat-p1-${Date.now()}-${categoryIds.length}` })`.
     - Tracks created category IDs in `createdCategoryIds`.
     - In `afterAll`: deletes dependent `size_guides` rows (`in("id", sizeGuideIds)` and `in("category_id", createdCategoryIds)`), then deletes created categories from `categories`.
  2. `sec002-004-rls.integration.test.ts`:
     - Queries `categories` with limit(4).
     - If fewer than 4 exist, creates missing rows via `admin.from("categories").insert({ slug: `test-cat-rls-${Date.now()}-${categoryIds.length}` })`.
     - Tracks created category IDs in `createdCategoryIds`.
     - In `afterAll`: deletes dependent `size_guides` rows (`in("id", sizeGuideIds)` and `in("category_id", createdCategoryIds)`), then deletes created categories from `categories`.
  3. `sec002-sec003-sec004-preservation.test.ts`:
     - In `describe("[3.9] admin coupon list retrievable via the service role")`:
       `beforeAll` checks if `WELCOME10` exists in `coupons`. If not, inserts:
       ```ts
       {
         code: "WELCOME10",
         discount_type: "percentage",
         discount_value: 10,
         min_order_amount: 50,
         is_active: true,
       }
       ```
       `afterAll` cleans up the created coupon if created by the test.
     - In `describe("[3.3] POST /api/coupons/validate preserves WELCOME10 validation")`:
       `beforeAll` similarly checks for `WELCOME10` and provisions the identical row via the service role if not present, ensuring independence whether run together or standalone.
       `afterAll` cleans up the created coupon if created by the test.
- **Commit:** `7fece73 test(fixtures): make category and coupon tests self-sufficient with explicit setup and teardown`

---

### Item 5 — `OTP_VERIFY_FIXED` in CI workflow
- **File:** `.github/workflows/test.yml`
- **Problem:** `integration-e2e` sets `SEC001_FIXED`, `P1_FIXED`, and `P2_FIXED` in job-level `env:`, but omitted `OTP_VERIFY_FIXED`. `otp-verify-500.exploration.test.ts` checks `process.env.OTP_VERIFY_FIXED === "1"`, defaulting to the UNFIXED branch and failing against the fixed codebase.
- **Change:**
  - Added `OTP_VERIFY_FIXED: "1"` to `integration-e2e`'s job-level `env:` block.
  - Added a one-line comment documenting it as the fourth fixed-state exploration toggle.
- **Commit:** `2cffa17 ci(test): set OTP_VERIFY_FIXED toggle in integration-e2e job`

---

## 3. Verification & Execution Status

### Tiers Actually Run Locally
1. `pnpm run audit:invariants:strict` — **PASSED** (all 14 invariants green).
2. `pnpm run typecheck` — **PASSED** (typecheck:libs, api-server, store, mockup-sandbox, scripts).
3. `pnpm run test:unit` — **PASSED** (58 test files passed, 670 tests passed across `store-unit` and `env-validation`).
4. `admin-routes.test.ts` (isolated router introspection) — **PASSED** (4 tests passed).

### Tiers Not Run Locally
- `api-integration` full suite and live `env-validation` HTTP tests against a live Supabase instance: **NOT run locally**. As documented in AGENTS.md, these tiers require live Supabase project credentials and a running API server with live network access; they run exclusively in CI (`.github/workflows/test.yml`). No production or remote database credentials were used or touched.

---

## 4. Real Command Outputs

### `pnpm run audit:invariants:strict`
```
> workspace@0.0.0 audit:invariants:strict C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\davam-840a9f
> node scripts/audit/check-invariants.mjs --strict

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
ok    stocktake-mutations-check-draft-status 0 total, 0 new
ok    no-on-hand-reads-on-storefront   0 total, 0 new
ok    no-sensitive-columns-in-exposed-views 0 total, 0 new

All invariant checks passed.
```

### `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\davam-840a9f
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck

> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\davam-840a9f
> tsc --build

Scope: 5 of 10 workspace projects
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

### `pnpm run test:unit`
```
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest\.claude\worktrees\davam-840a9f
> vitest --run --project store-unit --project env-validation

Test Files  58 passed (58)
     Tests  670 passed (670)
  Start at  22:32:28
  Duration  17.35s (transform 8.61s, setup 0ms, collect 23.82s, tests 6.39s, environment 8.86s, prepare 60.26s)
```

---

## 5. Git Commit Log

```
2cffa17 ci(test): set OTP_VERIFY_FIXED toggle in integration-e2e job
7fece73 test(fixtures): make category and coupon tests self-sufficient with explicit setup and teardown
31c79de test(receipts): fix loginTestUser argument order and add BASE_URL in goods-receipts-post-route.integration.test.ts
98d9695 test(admin): update EXPECTED_ROUTES in admin-routes.test.ts with M2 routes
7ce5dfb fix(db): add comments.rating column and mirror to schema.sql
```
