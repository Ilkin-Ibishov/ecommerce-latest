# Chore — fix the 2 real failures from CI round 4

Round 4 of the `integration-e2e` job (run 42272107493, branch `claude/davam-840a9f`) ran
1146 tests: 1132 passed, 1 failed, and 1 suite errored in `beforeAll` (cascading into a second
reported failure). Both root causes below have already been diagnosed by reading the actual
code and by reproducing the RLS failure directly against the live test Supabase project
(`ecommerce-warehouse`, ref `jcvsnoiacrknzejouxah`). Do not re-diagnose from scratch — implement
the fix described. If you find a diagnosis below is wrong once you read the code, stop and say
so in the notes file rather than guessing a different fix.

Two prescriptive items. Nothing else. Do not refactor anything nearby you were not told to
touch. Branch from `chore/ci-round4-fixes` (already created, based on `claude/davam-840a9f`).
One commit per item.

---

## 1. `goods-receipts-post-route.integration.test.ts` inserts a column that does not exist

`artifacts/api-server/tests/goods-receipts-post-route.integration.test.ts` (around line 49-54)
creates its test product like this:

```ts
const { data: product, error: prodErr } = await (serviceClient as any)
  .from("products")
  .insert({ title: "Receipt Integration Product", price: 25.0, stock: 0 })
  .select("id")
  .single();
```

`public.products` has no `title` column — `title` lives on `public.product_translations`
(`supabase/schema.sql` lines 127-165: `products` has `id, sku, slug, price, stock, is_featured,
is_on_sale, is_deal_of_day, sort_order, search_vector, created_at, updated_at` — plus `brand`,
added by a later migration — `slug` is `not null unique`). CI fails with: `Error: Failed to
create test product: Could not find the 'title' column of 'products' in the schema cache`, then
cascades into a second failure in the same suite (`TypeError: Cannot read properties of
undefined (reading 'id')` in `afterAll`, because `adminSession` setup never completed).

This test does not need a product title at all — it only needs a product row to attach a
variant to. Fix: drop `title` from the insert and add the required `slug`:

```ts
.insert({ slug: `receipt-int-${Date.now()}`, price: 25.0, stock: 0 })
```

Do not add a `product_translations` row — nothing in this test reads the title.

## 2. `comments_public_read` RLS policy is missing its "own rows" clause — real schema drift

`artifacts/api-server/tests/sec002-sec003-sec004-preservation.test.ts`'s test `"[3.4] ...
authenticated insert {approved:false} succeeds, stays hidden, admin approves via service role"`
fails with:

```
AssertionError: expected { code: '42501', ... message: 'new row violates row-level security
policy for table "comments"' } to be null
```

This is NOT a problem with the INSERT policy. Reproduced directly against the live test project
with `execute_sql`: `WITH CHECK (auth.uid() = user_id AND approved = false)` evaluates true and
a plain `INSERT ... (no RETURNING)` succeeds under `role authenticated`. The *same* insert with
`RETURNING` fails with the identical RLS error — because the test calls
`.insert({...}).select("id, approved").single()` (same as the live app code would for any
"submit my review" flow), and Postgres enforces the table's SELECT policies against a row
returned by an INSERT. `public.comments`'s only SELECT policy
(`supabase/schema.sql` line 799, policy `"Comments: public read approved"`) is:

```sql
create policy "Comments: public read approved" on public.comments for select using (approved = true);
```

There is no "or it's my own row" clause, so a user cannot read back their own freshly-submitted,
not-yet-approved comment — the INSERT succeeds but the `RETURNING`/`.select()` on it is denied.
Migration `supabase/migrations/20260627101714_sec004_comments_insert_unapproved_only.sql` (lines
13-16, 24) explicitly says this policy was "RETAINED" with the shape
`(select using approved = true OR own OR admin)` on some other, already-live database — but no
migration in this repository actually creates that fuller version. `schema.sql` and
`supabase/migrations/` are each missing it. This is real drift, not a test bug: fix the policy,
not the test.

Fix: add a new migration
`supabase/migrations/<timestamp>_fix_comments_public_read_own_rows.sql` that recreates the
policy with the clause the migration comment already describes:

```sql
drop policy if exists "Comments: public read approved" on public.comments;
drop policy if exists "comments_public_read" on public.comments;

create policy "comments_public_read" on public.comments for select using (
  approved = true
  or user_id = auth.uid()
  or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
```

(Drop both possible existing names defensively — different environments have used
`"Comments: public read approved"` and `"comments_public_read"` for what should be the same
policy; dropping a name that doesn't exist via `if exists` is a no-op.)

Mirror the same final policy into `supabase/schema.sql` in place of the current
`"Comments: public read approved"` line (keep the same policy name, `comments_public_read`, that
this migration creates, so schema.sql and a freshly-migrated database agree).

Do not apply this migration to any Supabase project yourself — you have no credentials and must
not acquire any. State in the notes file that it is written but unapplied, same as the existing
unapplied `20261107052641_create_banners.sql` migration already on this branch.

---

## Definition of done

- `pnpm run typecheck` and `pnpm run audit:invariants:strict` green
- `pnpm run test:unit` green
- Two commits, one per item above, each touching only the files that item names
- `docs/audits/chore-ci-round4-fixes-notes.md` written: both items, what you changed, and the
  real output of the commands you ran.

You cannot run `api-integration` or `env-validation` locally — they need live Supabase
credentials and a running API server. Do not claim they pass. Say plainly which tiers you
actually ran.

Do not run migrations against any remote Supabase project. Do not acquire or touch Supabase
credentials. Do not push. Do not touch `main`.
