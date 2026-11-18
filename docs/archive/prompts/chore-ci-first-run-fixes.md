# Chore — fix the 8 real failures from the first-ever integration run

The `integration-e2e` CI job has now run against a real Supabase project
(`ecommerce-warehouse`, ref `jcvsnoiacrknzejouxah`) for the first time ever. 1119 of 1146
tests passed. 8 failed, across 6 files. Every root cause below has already been diagnosed from
the CI log — do not re-diagnose from scratch, implement the fix described. If you find a
diagnosis below is wrong once you read the code, stop and say so in the notes file rather than
guessing a different fix.

Five prescriptive items. Nothing else. Do not refactor anything nearby you were not told to
touch. Branch from `chore/ci-first-run-fixes` (already created). One commit per item.

---

## 1. `comments.rating` column does not exist

`artifacts/api-server/src/routes/comments.ts` reads and writes a `rating` column (lines 13, 24,
26, 38) — integer 1–5, optional. No migration and no `supabase/schema.sql` entry ever created
it. Two tests fail with Postgres error `PGRST204: Could not find the 'rating' column of
'comments' in the schema cache`:
- `artifacts/api-server/tests/sec002-004-p1.exploration.test.ts` — "SEC-004 exploration: comment
  moderation bypass via anon client (Property 4)"
- `artifacts/api-server/tests/sec002-004-rls.integration.test.ts` — "SEC-004 RLS integration
  (task 16): comment moderation enforced on insert (Property 4)"

Fix: add a new migration `supabase/migrations/<timestamp>_add_comments_rating_column.sql`:

```sql
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS rating integer CHECK (rating >= 1 AND rating <= 5);
```

Mirror the same column into `supabase/schema.sql`'s `public.comments` table definition. Do not
apply this migration to any Supabase project yourself — you have no credentials and must not
acquire any. State in the notes file that it is written but unapplied.

## 2. `admin-routes.test.ts`'s expected route list is stale

`artifacts/api-server/tests/admin-routes.test.ts`'s `EXPECTED_ROUTES` array (around line 60) was
last updated for task 10.2 (R9.4) and never updated when the M2a/M2b admin routes (receipts,
stocktakes, suppliers) were added. Both tests in the `describe("admin router registration
parity"...)` block fail: the set-parity test and the full-order test.

Fix: read the actual registration order from `artifacts/api-server/src/routes/admin/index.ts`
and the route definitions in `receipts.ts`, `stocktakes.ts`, and `suppliers.ts` (same directory).
Add the missing entries to `EXPECTED_ROUTES` in their true registration position — the second
test (`preserves the full registration order`) asserts exact order, so position matters, not
just membership. Add a `// receipts.ts` / `// stocktakes.ts` / `// suppliers.ts` comment above
each new block, matching the existing style (see the `// products.ts`, `// banners.ts` comments
already there). Do not weaken either assertion into something order-insensitive.

## 3. Argument order bug in a test file, not the helper

`artifacts/api-server/tests/goods-receipts-post-route.integration.test.ts:37`:

```ts
adminSession = await loginTestUser(adminPhone, "admin");
```

`loginTestUser`'s real signature (`tests/helpers/auth.ts:25-28`) is
`loginTestUser(baseUrl: string, phone: string)`. Every other test file in this suite defines
`const BASE_URL = process.env.API_URL || "http://localhost:5000";` near the top and calls
`loginTestUser(BASE_URL, phone)` — this file has no `BASE_URL` constant at all, and the call
passes the phone number where `baseUrl` is expected (the `"admin"` string is simply discarded,
there is no `role` parameter). This produces `TypeError: Failed to parse URL from
+994505305664/api/dev/mock-otp`.

Fix: add the same `const BASE_URL = process.env.API_URL || "http://localhost:5000";` constant
used elsewhere in the suite, and change the call to `loginTestUser(BASE_URL, adminPhone)`.

## 4. Two test files assume seed data that exists nowhere in version control

Three tests fail because they query for fixture rows that were apparently hand-created against
some real project at some point, but never captured in any migration, schema.sql, or
`supabase/seed.sql`:

- `tests/sec002-004-p1.exploration.test.ts:107` and `tests/sec002-004-rls.integration.test.ts:163`
  — both throw `[SEC-002] need >=3/>=4 categories for distinct rows` because they query
  `categories` expecting rows that don't exist on a fresh database.
- `tests/sec002-sec003-sec004-preservation.test.ts` — two tests (`[3.9] admin coupon list
  retrievable via the service role`, `[3.3] POST /api/coupons/validate preserves WELCOME10
  validation`) expect a coupon with code `WELCOME10` to already exist.

Do not add a seed script. The correct fix is to make each test self-sufficient: create the
categories / coupon it needs in its own `beforeAll`/`beforeEach` (via the service-role client,
same pattern already used elsewhere in these files for other fixtures — e.g. look at how
`testSupplierId`/`testProductId` are created in `goods-receipts-post-route.integration.test.ts`
or how `tests/helpers/cleanup.ts` and `tests/helpers/isolation.ts` are used for test isolation
elsewhere in this suite), and clean them up afterward the same way the rest of the suite does.
Read each failing test's existing `beforeAll` first — if it already creates some fixtures but
not enough categories, extend it minimally; don't rewrite what already works. For the
`WELCOME10` coupon, create it with whatever `discount_type`/`discount_value` the test's own
assertions require (read what `[3.3]` expects the validate response to contain) and delete it in
an `afterAll`.

If a test's required fixture shape is genuinely ambiguous from reading the test alone, say so in
the notes file and leave that one test's fix undone rather than guessing.

## 5. `OTP_VERIFY_FIXED` is never set in CI

`artifacts/api-server/tests/otp-verify-500.exploration.test.ts:51`:
`const EXPECT_FIXED = process.env.OTP_VERIFY_FIXED === "1";`. `.github/workflows/test.yml`'s
`integration-e2e` job sets `SEC001_FIXED`, `P1_FIXED`, `P2_FIXED` in its job-level `env:` block
(around line 47) but never `OTP_VERIFY_FIXED`, so this test always runs the UNFIXED branch and
asserts the old pre-fix 500 behavior — which no longer happens now that the fix is live, so it
fails expecting `capturedError` to be a `TypeError` that the fix prevents.

Fix: add `OTP_VERIFY_FIXED: "1"` to that same job-level `env:` block, next to the other three
`_FIXED` toggles, with a one-line comment extending the existing explanatory comment block
(don't duplicate the whole comment, just note this is the fourth toggle).

---

## Definition of done

- `pnpm run typecheck` and `pnpm run audit:invariants:strict` green
- `pnpm run test:unit` green
- Five commits, one per item above, each touching only the files that item names
- `docs/audits/chore-ci-first-run-fixes-notes.md` written: each of the five items, what you
  changed, and the real output of the commands you ran. For item 4, name exactly what fixture
  data each test now creates for itself.

You cannot run `api-integration` or `env-validation` locally — they need live Supabase
credentials and a running API server, which is the whole reason this chore exists. Do not claim
they pass. Say plainly which tiers you actually ran.

Do not run migrations against any remote Supabase project. Do not acquire or touch Supabase
credentials. Do not push. Do not touch `main`.
