# Implementation Notes — Chore `counter_sale_payments` Fix Round

**Date:** 2026-11-14  
**Branch:** `chore/counter-sale-payments`  
**Inputs:** `docs/audits/chore-counter-sale-payments-audit.md`, `prompts/chore-counter-sale-payments-fix.md`, `AGENTS.md`

---

## 1. Changes per Item

### Item 1 — B1: Integration Test Tender & Post Error Assertions
- **File:** `artifacts/api-server/tests/counter-sale-payments.integration.test.ts`
- **Change:** Changed payment method from `bank_transfer` to `other` in the void test (`counter_sales.payment_method` CHECK permits only `cash`, `card`, `other`). Added explicit assertions `expect(res.error).toBeNull()` on every `post_counter_sale` invocation across the test suite.
- **Commit:** `02955ad test(payments): assert post errors and use other tender in integration tests`

### Item 2 — B2 & m2: Trigger Placement & Event Scope
- **Files:**
  - `supabase/migrations/20261113230200_counter_sale_payments.sql`
  - `supabase/migrations/20261113230400_post_counter_sale_payments.sql`
- **Change:** Moved `chk_counter_sales_has_payments()` and trigger `trg_counter_sales_has_payments` out of `20261113230200` and placed them into `20261113230400` after the `post_counter_sale` function and its privileges. Updated trigger definition to `AFTER INSERT OR UPDATE OF total_amount` (m2) so any subsequent update to `total_amount` must revalidate payment balance.
- **Commit:** `2e7d3a4 fix(payments): move sales has_payments trigger to post_counter_sale migration and trigger on total_amount update`

### Item 3 — M3: Re-runnable Backfill
- **File:** `supabase/migrations/20261113230300_counter_sale_payments_backfill.sql`
- **Change:** Replaced `ON CONFLICT (sale_id, method) DO NOTHING` with `WHERE NOT EXISTS (SELECT 1 FROM public.counter_sale_payments p WHERE p.sale_id = cs.id)`. When split sales exist later, re-running the migration will not insert redundant rows for already settled sales.
- **Commit:** `58f1798 fix(payments): use WHERE NOT EXISTS for counter_sale_payments backfill`

### Item 4 — M1: Missing Integration Tests
- **File:** `artifacts/api-server/tests/counter-sale-payments.integration.test.ts`
- **Change:** Added the three missing integration test cases described in Audit M1:
  1. Hand-inserted two-leg split with sum unchanged (`amount = 0`, second tender) commits successfully.
  2. Split that does not sum to the sale total (`amount > 0` on an existing sale) is refused at commit with error code `ST027`.
  3. Backfill verification: asserts 0 sales exist without payment rows, and 0 sales exist where payment sums differ from `total_amount`.
- **Commit:** `93190d2 test(payments): add split leg and backfill integration tests`

### Item 5 — M2: Invariant Parser Strengthening & Post-Function Payment Check
- **Files:**
  - `scripts/audit/check-invariants.mjs`
  - `artifacts/store/src/__tests__/counter-sale-payments.test.ts`
- **Change:**
  - Strengthened `no-client-writes-on-counter-sale-payments` in `check-invariants.mjs` to detect `ALL TABLES IN SCHEMA`, comma-separated table lists, quoted identifiers (`"public"."counter_sale_payments"`), and unquoted policy names. Added the four audit failure cases as failing fixtures.
  - Added second invariant check `post-counter-sale-writes-payments`: validates that the latest migration defining `post_counter_sale` in file order contains `INSERT INTO public.counter_sale_payments`. Added passing and failing fixture tests for this invariant.
- **Commit:** `1eb8b2b test(invariants): strengthen counter_sale_payments grant and policy checks and verify post_counter_sale payment insert`

### Item 6 — m1, m3, m4: Policy Rename, Relocate Invariant Fixtures & Drop Unused Index
- **Files:**
  - `supabase/migrations/20261113230100_payment_methods.sql`
  - `supabase/migrations/20261113230200_counter_sale_payments.sql`
  - `artifacts/store/src/__tests__/counter-sale-payments.test.ts` -> `artifacts/store/src/__tests__/invariant-counter-sale-payments.test.ts`
- **Change:**
  - Renamed policy `"PaymentMethods: staff/admin read"` to `"PaymentMethods: authenticated read"` in `20261113230100_payment_methods.sql` to accurately reflect its `TO authenticated USING (true)` definition (m1).
  - Dropped unused index `idx_counter_sale_payments_method` from `20261113230200_counter_sale_payments.sql` (m4).
  - Moved invariant fixture tests beside existing invariant test suites, renaming file to `invariant-counter-sale-payments.test.ts`, and removed fragile SQL string-matching assertions (m3).
- **Commit:** `b78f5eb refactor(payments): rename payment_methods policy, relocate invariant fixtures, and drop unused index`

---

## 2. Tiers Run Locally

- `pnpm run audit:invariants`: **PASSED** (17 checks: 0 total, 0 new violations).
- `pnpm run typecheck`: **PASSED** (0 errors across all 5 workspace projects).
- `pnpm test:unit`: **PASSED** (696 passed across 62 test files).
- **Integration tier:** **NOT RUN**. Migrations have not yet been applied to the test project; per instructions, a human applies them before CI executes the integration suite.

---

## 3. Database Types Status

`database.types.ts` was **not regenerated**. Regenerating Supabase database types requires introspecting a remote or local database with the new migrations applied. Because applying migrations to the remote database is deferred to a human after this fix round, and touching the Supabase project directly was prohibited, `database.types.ts` remains as-is until migrations are applied.
