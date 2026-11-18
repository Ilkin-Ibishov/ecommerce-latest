# Phase M2b — Fix Notes & Invariant Scoping Verification

**Date:** 2026-11-04  
**Branch:** `m2b/stocktake`  
**Prompt:** `prompts/m2b-fix.md`  
**Reference Design Note:** `docs/design-notes/m2b-stocktake.md`  

---

## 1. Breakdown of Fixes

### 1.1 Scope Snapshot Query & Reject Missing Snapshots in Variance Service

- **Problem:**
  In `artifacts/api-server/src/lib/stocktake-variance.ts` (line 36), the variance service previously queried the entire `stocktake_line_snapshots` table without any filters:
  ```ts
  const { data: snapshots } = await (admin as any)
    .from("stocktake_line_snapshots")
    .select("line_id, snapshot_on_hand, captured_at");
  ```
  Every other query in the function was scoped (`.eq("stocktake_id", stocktakeId)` or `.in("id", variantIds)`). An unfiltered fetch meant downloading every snapshot row ever captured across all stocktakes in tenant history. If truncated by PostgREST row limits or pagination, rows belonging to the active count could be omitted.

  Worse, line 101 fell back to current on-hand when a snapshot was missing:
  ```ts
  const snapshotOnHand = snapshotMap.get(latestLine.id) ?? currentOnHand;
  ```
  This silently reverted the variance review to absolute-set semantics ($variance = counted - current\_on\_hand$), masking sales that occurred during the count. Posting (`post_stocktake`) would still compute delta against snapshots in SQL, meaning the owner reviewed and approved one set of numbers while posting applied another.

- **Resolution:**
  1. Scoped the snapshots query strictly to `lineIds` of the stocktake being reviewed, consistent with all other queries in the function:
     ```ts
     const lineIds = (lines ?? []).map((l: any) => l.id);

     const { data: snapshots, error: snapErr } = lineIds.length > 0
       ? await (admin as any)
           .from("stocktake_line_snapshots")
           .select("line_id, snapshot_on_hand, captured_at")
           .in("line_id", lineIds)
       : { data: [], error: null };

     if (snapErr) throw new Error(snapErr.message || "Failed to fetch snapshots");
     ```
  2. Stopped papering over missing snapshots. If any count line lacks a captured snapshot, the invariant is broken (the `AFTER INSERT` trigger writes exactly one snapshot per line). The service immediately rejects the request:
     ```ts
     for (const line of lines ?? []) {
       if (!snapshotMap.has(line.id)) {
         throw new Error(`Missing snapshot for stocktake line ${line.id} (variant ${line.variant_id})`);
       }
     }
     ```
     And for the latest line in each variant group:
     ```ts
     const snapshotOnHand = snapshotMap.get(latestLine.id);
     if (snapshotOnHand === undefined) {
       throw new Error(`Missing snapshot for stocktake line ${latestLine.id} (variant ${variantId})`);
     }
     ```
     Under no condition is `currentOnHand` ever substituted as a fallback.

### 1.2 Migration Header Comment Correction

- **Problem:**
  The header of `supabase/migrations/20261104140000_m2b_stocktake_functions.sql` advertised a non-existent database function:
  `--   3. get_stocktake_variance: Returns owner review dataset with monetary sorting and interleaved trade warnings`
- **Resolution:**
  Corrected line 7 in the migration header to accurately document that variance computation is performed in TypeScript via `artifacts/api-server/src/lib/stocktake-variance.ts`.

### 1.3 Test Coverage Added

Added comprehensive unit and structural tests in `artifacts/store/src/__tests__/stocktake-variance.test.ts`:
1. **Missing snapshot invariant test:**
   Verifies that when a count line's snapshot row is missing, `computeStocktakeVariance` rejects the request with an actionable error and never computes a variance using current on-hand.
2. **Snapshot query scoping test:**
   Verifies that `stocktake_line_snapshots` is queried strictly with `.in("line_id", lineIds)` matching only the active stocktake's lines, ignoring unrelated snapshots from other stocktakes in the database.
3. **Static regression guard:**
   Inspects `stocktake-variance.ts` to assert that `.in("line_id", lineIds)` is present and that `?? currentOnHand` fallback is completely removed.

---

## 2. Command Verification & Real Outputs

### 2.1 Architectural Invariants Check
Command: `pnpm run audit:invariants:strict`
```text
> workspace@0.0.0 audit:invariants:strict C:\Users\user\Documents\ecommerce-latest
> node scripts/audit/check-invariants.mjs --strict

ok    ledger-only-stock-writes         0 total, 0 new
ok    rls-on-new-tables                0 total, 0 new
ok    no-has-variants-flag             0 total, 0 new
ok    no-customer-industry-naming      0 total, 0 new
ok    reservations-are-not-movements   0 total, 0 new
ok    on-hand-repair-setting-isolation 0 total, 0 new
ok    no-direct-variant-costs-writes   0 total, 0 new
ok    no-cost-column-on-staff-tables   0 total, 0 new
ok    no-expected-quantity-on-staff-endpoints 0 total, 0 new
ok    security-definer-service-role-privileges 0 total, 0 new

All invariant checks passed.
```

### 2.2 TypeScript Typecheck
Command: `pnpm run typecheck`
```text
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck


> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest
> tsc --build

Scope: 5 of 10 workspace projects
scripts typecheck: Done
artifacts/supabase-types typecheck: Done
artifacts/mockup-sandbox typecheck: Done
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```

### 2.3 Unit Test Suite
Command: `pnpm run test:unit`
```text
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  store-unit  src/__tests__/stocktake-variance.test.ts (3 tests) 9ms
 ✓  store-unit  src/__tests__/stocktake-reconciliation.test.ts (4 tests) 7ms
 ✓  store-unit  src/__tests__/stocktake-posting-integrity.test.ts (5 tests) 6ms
 ✓  store-unit  src/__tests__/blind-counting-security.test.ts (4 tests) 6ms
 ...
 Test Files  49 passed (49)
      Tests  598 passed (598)
   Duration  5.06s
```

---

## 3. Operating Constraints & Status Truths

1. **Adversarial Audit Status:**
   The Opus 4.6 adversarial run died on quota partway through and committed nothing. Its quota resets in approximately six days. Phase M2b has had the architect's review and mechanical checks, but not an independent adversarial audit from a different model family.
2. **Local Repository State:**
   `main` is local-only and unpushed (containing M1 and M2a). M2b work is committed on phase branch `m2b/stocktake`.
3. **Database & CI Integration Tier:**
   No migration has ever been executed against a real Postgres database. CI integration tests have been failing since 1 July 2026; known required work includes configuring a dedicated test Supabase project with its three secrets, applying migrations, adding `SESSION_SECRET` to `test.yml`, and updating the stale assertion in `otp-verify-500.exploration.test.ts`.
4. **Blind Counting Honest Boundary:**
   Staff tokens cannot read snapshots or expected quantities via stocktake endpoints, but could query `product_variants.on_hand` directly because storefront/admin availability paths currently require read access to that column. This limitation is formally recorded in `.agents/rules/inventory.md`.
