# Chore Batch 03 — Implementation Notes

**Date:** 2026-11-02  
**Branch:** `chore/batch-01`

---

## 1. Changes per Task

### Task 1 — Flaky Category-Tree Property Test Fix

- **Diagnosis:**
  - In `artifacts/store/src/__tests__/storefront-ux.property.test.ts`, the property test `consecutive segments follow parent-child relationship` constructs a lookup map `slugToNode = new Map<string, CategoryNode>()` by walking the generated category tree.
  - The generator `categoryTreeArb` generated root slugs via `fc.string(...)` and child slugs via `${cSlug}-${i}`. Because `fc.string` can generate duplicate strings across entries and `fast-check` shrinks strings toward minimal values (such as `" "` or empty strings), two nodes in different branches could be assigned identical slugs (and identical shrunk UUIDs).
  - When multiple nodes shared a slug, `slugToNode.set(n.slug, n)` retained only the last node encountered in tree traversal order. When `resolveBreadcrumbPath` returned a breadcrumb path traversing through the earlier node, the test's `slugToNode.get(childSlug)` resolved to the sibling branch's node instead. Consequently, `expect(childNode.parent_id).toBe(parentNode.id)` failed against the wrong node.
- **Approach Chosen & Justification:**
  - *Fix at source (generator fixture):* We chose to enforce uniqueness of slugs (and node IDs) across the generated tree fixture by prefixing each generated node slug with a monotonically increasing sequence index (`slug-${nodeIdx++}-${rawSlug}` for roots, and `slug-${nodeIdx++}-${cSlug}-${i}` for children, along with unique child IDs).
  - *Why this choice keeps the property honest:* In web applications and storefront routing, `/categories/:slug` is an unambiguous identifier. Duplicate category slugs violate fundamental routing and domain invariants. Fixing the generator ensures generated category trees represent valid domain structures while keeping the test assertion (`expect(childNode.parent_id).toBe(parentNode.id)`) completely intact, honest, and unweakened.
- **Stability Verification & Proof:**
  - Temporarily increased `numRuns` on `consecutive segments follow parent-child relationship` from `100` to `5,000` (which previously reproduced the flaky failure at run 3,535). With the fix applied, all 5,000 runs passed cleanly.
  - Further increased `numRuns` to `10,000` runs; all 10,000 runs passed cleanly in 858ms.
  - Restored `numRuns` to the file's standard `100` runs prior to commit.
- **Scope Discipline:**
  - Only `categoryTreeArb` was modified in `storefront-ux.property.test.ts`. No assertions were modified or loosened, and no other tests were touched.

### Task 2 — Stop Tracking Agent Run Logs

- **`.gitignore` Update:** Added `.agent-runs/` to `.gitignore` under agent configurations. No other entries or lines in `.gitignore` were modified.
- **Index Removal:** Executed `git rm -r --cached .agent-runs`, untracking all 4 tracked files from the git index (`chore-01-20261102-122008.log`, `chore-02-20261102-141128.log`, `test-output.txt`, `test-unit.txt`) while leaving the directory and files untouched on the local filesystem.

---

## 2. Decisions & What Was Not Done

1. **No Assertion Modification:** Did not weaken or rewrite the `consecutive segments follow parent-child relationship` test assertion. The parent-child invariant is preserved in full.
2. **Untouched Tests:** No other tests in `storefront-ux.property.test.ts` or other test suites were touched.
3. **Local Run Logs Preserved:** Did not delete `.agent-runs` from the local filesystem; it remains untracked and preserved locally.
4. **Isolated Commits:** Task 1 and Task 2 were kept and committed as distinct, atomic commits.

---

## 3. Verification Commands & Real Output

### `pnpm run typecheck`
```
> workspace@0.0.0 typecheck C:\Users\user\Documents\ecommerce-latest
> pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck

> workspace@0.0.0 typecheck:libs C:\Users\user\Documents\ecommerce-latest
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
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

Test Files  31 passed (31)
     Tests  516 passed (516)
```

### `pnpm run audit:invariants`
```
> workspace@0.0.0 audit:invariants C:\Users\user\Documents\ecommerce-latest
> node scripts/audit/check-invariants.mjs

ok    ledger-only-stock-writes         6 total, 0 new
ok    rls-on-new-tables                0 total, 0 new
ok    no-has-variants-flag             0 total, 0 new
ok    no-customer-industry-naming      0 total, 0 new
ok    reservations-are-not-movements   0 total, 0 new
6 violation(s) carried in baseline (run with --strict to fail on these).

All invariant checks passed.
```
