# Phase M2b — Second Fix Pass Notes: Stocktake Posting Arithmetic & Staleness Guards

**Date:** 2026-11-04  
**Branch:** `m2b/stocktake`  
**Prompt:** `prompts/m2b-fix-2.md`  
**Reference Design Note:** `docs/design-notes/m2b-stocktake.md`  

---

## 1. Executive Summary

An adversarial review of `post_stocktake` identified four critical defects in posting arithmetic and multi-counter resolution lifecycle:
1. **A1 [Blocker]:** The opening count delta calculation erroneously posted `effective_counted` as the delta, adding the counted quantity to the migrated legacy balance rather than replacing it.
2. **A2 [Must]:** A `CROSS JOIN LATERAL` dropped count lines missing snapshots silently from posting, leaving uncorrected variances without raising errors.
3. **A3 [Must]:** Verified that counted-zero lines correctly produce negative deltas (e.g. `0 - 5 = -5`) to clear legacy balances to zero in both opening and ordinary counts.
4. **A4 [Must]:** Multi-counter resolutions could go stale if new scans arrived after review. Added staleness tracking columns (`resolved_line_count`, `resolved_latest_line_at`), pre-flight blocking with `ST011`, and variance screen re-resolution notification.

All four defects were resolved with one dedicated git commit per defect in order A1–A4. All architectural invariants, full workspace typechecks, and unit test suites are green with zero baseline debt.

---

## 2. Breakdown of Changes per Defect

### 2.1 A1 — Opening Count Delta Arithmetic [Blocker]
- **Commit:** `fab50f4 fix(inventory): compute opening count delta against snapshot to replace legacy balance`
- **Location:** `supabase/migrations/20261104140000_m2b_stocktake_functions.sql` inside `post_stocktake` CTE `variant_deltas`.
- **Change:**
  - Removed the branching conditional that set `delta = effective_counted` when `v_st.is_opening_count` was true.
  - Unified the delta calculation to `(effective_counted - effective_snapshot) AS delta` across both opening counts and ordinary counts.
  - Preserved the movement reason mapping: opening counts write `opening_balance::stock_movement_reason`, ordinary counts write `stocktake_correction::stock_movement_reason`.
  - Added documentation comment before `INSERT INTO public.stock_movements`:
    ```sql
    -- An opening_balance movement may be negative, because an opening count establishes
    -- the true quantity over a migrated placeholder, and the sum of a variant's opening_balance
    -- movements is its established opening quantity.
    ```
- **Tests Added (4 tests in `artifacts/store/src/__tests__/stocktake-posting-integrity.test.ts`):**
  1. Legacy opening balance 5, counted 7, opening count $\rightarrow$ on-hand ends at exactly 7 with movement `+2`.
  2. Legacy opening balance 0, counted 7, opening count $\rightarrow$ ends at 7 with movement `+7`.
  3. Legacy opening balance 5, counted 5, opening count $\rightarrow$ ends at 5 with zero movements written (delta 0 filtered).
  4. Ordinary count, snapshot 5, counted 7 $\rightarrow$ ends at 7 with reason `stocktake_correction` and delta `+2`.

---

### 2.2 A2 — Missing Snapshot Invariant Guard [Must]
- **Commit:** `af393f2 fix(inventory): prevent silent omission of lines lacking snapshots in posting (A2)`
- **Location:** `supabase/migrations/20261104140000_m2b_stocktake_functions.sql` inside `post_stocktake`.
- **Change:**
  - Replaced `CROSS JOIN LATERAL` with `LEFT JOIN LATERAL (...) latest_snap ON true` in `reconciled` CTE to prevent silent row dropping.
  - Added an explicit pre-flight check before movement insertion:
    ```sql
    SELECT vs.variant_id INTO v_missing_snap_variant
    FROM (
      SELECT DISTINCT variant_id
      FROM public.stocktake_lines
      WHERE stocktake_id = p_stocktake_id
    ) vs
    LEFT JOIN LATERAL (
      SELECT stls.snapshot_on_hand
      FROM public.stocktake_lines stl
      JOIN public.stocktake_line_snapshots stls ON stls.line_id = stl.id
      WHERE stl.stocktake_id = p_stocktake_id AND stl.variant_id = vs.variant_id
      ORDER BY stl.created_at DESC
      LIMIT 1
    ) latest_snap ON true
    WHERE latest_snap.snapshot_on_hand IS NULL
    LIMIT 1;

    IF v_missing_snap_variant IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot post stocktake %: variant % has count lines with no system snapshot',
        p_stocktake_id, v_missing_snap_variant USING ERRCODE = 'ST010';
    END IF;
    ```
- **Tests Added (1 test in `artifacts/store/src/__tests__/stocktake-posting-integrity.test.ts`):**
  5. Stocktake with two lines; deleted one line's snapshot row $\rightarrow$ assert posting raises `ST010` and **no movements** are written for either variant.

---

### 2.3 A3 — Counted-Zero Line Clearing Non-Zero Balance [Must]
- **Commit:** `1e5ac2b test(inventory): verify counted-zero lines clear non-zero quantities in opening and ordinary stocktakes`
- **Location:** `artifacts/store/src/__tests__/stocktake-posting-integrity.test.ts`.
- **Change:**
  - As noted in the prompt, no SQL logic change was necessary: `WHERE vd.delta <> 0` correctly permits negative movements. Fixing A1 allows `0 - 5 = -5` to post cleanly.
- **Tests Added (2 tests in `artifacts/store/src/__tests__/stocktake-posting-integrity.test.ts`):**
  6. On-hand 5 from legacy opening balance, counted 0, opening count $\rightarrow$ single movement of `-5` with reason `opening_balance`, on-hand ends at 0.
  7. On-hand 5, counted 0, ordinary count $\rightarrow$ single movement of `-5` with reason `stocktake_correction`, on-hand ends at 0.

---

### 2.4 A4 — Resolution Staleness Lifecycle & Guard [Must]
- **Commit:** `db8b185 fix(inventory): prevent posting with stale multi-counter scan resolutions (A4)`
- **Locations:**
  - `supabase/migrations/20261104150000_m2b_resolution_staleness.sql`
  - `supabase/schema.sql`
  - `artifacts/supabase-types/src/database.types.ts`
  - `artifacts/api-server/src/routes/admin/stocktakes.ts`
  - `artifacts/api-server/src/lib/stocktake-variance.ts`
  - `artifacts/store/src/__tests__/stocktake-posting-integrity.test.ts`
  - `artifacts/store/src/__tests__/stocktake-variance.test.ts`
- **Change:**
  1. Created migration `20261104150000_m2b_resolution_staleness.sql` adding `resolved_line_count integer NOT NULL` and `resolved_latest_line_at timestamptz NOT NULL` to `public.stocktake_resolutions`.
  2. Extended `post_stocktake` pre-flight check in migration:
     ```sql
     SELECT sr.variant_id INTO v_stale_variant
     FROM public.stocktake_resolutions sr
     LEFT JOIN (
       SELECT
         variant_id,
         COUNT(*) AS current_line_count,
         MAX(created_at) AS current_latest_line_at
       FROM public.stocktake_lines
       WHERE stocktake_id = p_stocktake_id
       GROUP BY variant_id
     ) cur ON cur.variant_id = sr.variant_id
     WHERE sr.stocktake_id = p_stocktake_id
       AND (
         COALESCE(cur.current_line_count, 0) <> sr.resolved_line_count
         OR cur.current_latest_line_at > sr.resolved_latest_line_at
       )
     LIMIT 1;

     IF v_stale_variant IS NOT NULL THEN
       RAISE EXCEPTION 'Cannot post stocktake %: resolution for variant % is stale - lines changed after it was recorded',
         p_stocktake_id, v_stale_variant USING ERRCODE = 'ST011';
     END IF;
     ```
  3. In `artifacts/api-server/src/routes/admin/stocktakes.ts` (`POST /admin/stocktakes/:id/resolve`), populated `resolved_line_count` from `lines.length` and `resolved_latest_line_at` from `MAX(created_at)` of current lines for that variant.
  4. In `artifacts/api-server/src/lib/stocktake-variance.ts`, detected stale resolutions when current lines count differs or `MAX(created_at) > resolved_latest_line_at`. Kept `countedQuantity` reading `resolved_quantity` (did not silently recalculate sum), but marked `resolutionStatus = "unresolved_conflict"`. This triggers the existing amber review UI and increments `unresolved_conflicts_count`, disabling the Post button in the client.
- **Tests Added (2 tests):**
  8. Three-step sequence in `stocktake-posting-integrity.test.ts`: resolve, add late scan, attempt post (asserts `ST011` and zero movements written), re-resolve, post succeeds with quantity including the late scan.
  9. Variance staleness unit test in `stocktake-variance.test.ts`: asserts stale resolution is marked `resolution_status = "unresolved_conflict"` and increments `unresolved_conflicts_count` without recalculating `counted_quantity`.

---

## 3. Observations on Instructions & File Length Justification

1. **File Length Justification for `20261104150000_m2b_resolution_staleness.sql` (242 lines):**  
   Per `AGENTS.md`, any file over 200 lines requires justification. This migration replaces `post_stocktake` in its entirety rather than modifying a prior migration file. Consolidating the full function definition in this migration guarantees clean single-transaction deployment in PostgreSQL and ensures that the pre-flight check, snapshot validation, and movement posting run with identical logic across fresh database bootstraps.
2. **Error Code `ST010` Pre-existence:**  
   Prompt A2 stated: `ERRCODE = 'ST010'. ST010 is unused in this schema; use it.`  
   In reality, `ST010` was already utilized in step 3 of `post_stocktake` for `posting_date < stls.captured_at`. As instructed ("If you believe an instruction here is wrong, implement it as written and say so in your notes — do not silently substitute your own design"), we implemented `ST010` exactly as requested for missing snapshots.
3. **OpenAPI Spec Preservation:**  
   The request payload for `/admin/stocktakes/:id/resolve` was preserved without modification because `resolved_line_count` and `resolved_latest_line_at` are derived server-side from `stocktake_lines` directly. Consequently, no API breaking changes or codegen regenerations were required.

---

## 4. Real Command Outputs

### 4.1 `pnpm run audit:invariants:strict`
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

### 4.2 `pnpm run test:unit`
```text
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  store-unit  src/__tests__/costing-engine-replay.property.test.ts (3 tests) 21ms
 ✓  store-unit  src/__tests__/heading-hierarchy.property.test.ts (8 tests) 50ms
 ✓  store-unit  src/lib/settings/theme-engine.property.test.ts (4 tests) 74ms
 ✓  store-unit  src/__tests__/cart-validation.test.ts (25 tests) 157ms
 ✓  store-unit  src/__tests__/order-tracking.property.test.ts (6 tests) 208ms
 ✓  store-unit  src/lib/settings/cms-rendering.property.test.ts (14 tests) 269ms
 ✓  store-unit  src/__tests__/translated-field.property.test.ts (3 tests) 51ms
 ✓  store-unit  src/__tests__/admin-list.property.test.ts (7 tests) 64ms
 ✓  store-unit  src/__tests__/image-proxy.property.test.ts (5 tests) 65ms
 ✓  store-unit  src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 104ms
 ✓  store-unit  src/__tests__/admin-logic.test.ts (32 tests) 24ms
 ✓  store-unit  src/__tests__/admin-components.property.test.ts (6 tests) 48ms
 ✓  store-unit  src/__tests__/i18n-split.property.test.ts (2 tests) 47ms
 ✓  env-validation  tests/env-validation.test.ts (9 tests) 22ms
 ✓  store-unit  src/__tests__/i18n-consistency.test.ts (16 tests) 29ms
 ✓  store-unit  src/__tests__/allow-negative-stock.test.ts (9 tests) 31ms
 ✓  store-unit  src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 26ms
 ✓  store-unit  src/lib/settings/context.test.ts (32 tests) 36ms
 ✓  store-unit  src/__tests__/brand-marquee.test.ts (8 tests) 359ms
 ✓  store-unit  src/__tests__/stocktake-posting-integrity.test.ts (14 tests) 25ms
 ✓  store-unit  src/__tests__/admin-components.test.ts (17 tests) 38ms
 ✓  store-unit  src/__tests__/stocktake-variance.test.ts (4 tests) 28ms
 ✓  store-unit  src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 21ms
 ✓  store-unit  src/lib/settings/storefront-rendering.property.test.ts (11 tests) 865ms
 ✓  store-unit  src/__tests__/i18n-preservation.test.ts (36 tests) 51ms
 ✓  store-unit  src/__tests__/admin-i18n.property.test.ts (2 tests) 87ms
 ✓  store-unit  src/__tests__/fixtures.test.ts (7 tests) 15ms
 ✓  store-unit  src/pages/admin/SettingsPage.test.ts (22 tests) 21ms
 ✓  store-unit  src/__tests__/staff-cost-reachability.test.ts (6 tests) 14ms
 ✓  store-unit  src/__tests__/queries.test.ts (14 tests) 19ms
 ✓  store-unit  src/lib/settings/default-rendering.test.ts (17 tests) 23ms
 ✓  store-unit  src/__tests__/storefront-ux.property.test.ts (25 tests) 3349ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  2615ms
 ✓  store-unit  src/__tests__/image-proxy.unit.test.ts (25 tests) 31ms
 ✓  store-unit  src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 36ms
 ✓  store-unit  src/components/admin/ImageCandidateGrid.test.ts (9 tests) 13ms
 ✓  store-unit  src/__tests__/unit-cost-privacy.test.ts (3 tests) 13ms
 ✓  store-unit  src/__tests__/stocktake-reconciliation.test.ts (4 tests) 16ms
 ✓  store-unit  src/__tests__/barcode-pack-quantity.test.ts (6 tests) 18ms
 ✓  store-unit  src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 17ms
 ✓  store-unit  src/lib/settings/theme-engine.test.ts (15 tests) 18ms
 ✓  store-unit  src/__tests__/receiving-cost-integrity.test.ts (5 tests) 23ms
 ✓  store-unit  src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 16ms
 ✓  store-unit  src/__tests__/adjustment-role-guards.test.ts (4 tests) 15ms
 ✓  store-unit  src/__tests__/margin-report-granularity.test.ts (3 tests) 13ms
 ✓  store-unit  src/__tests__/blind-counting-security.test.ts (4 tests) 19ms
 ✓  store-unit  src/__tests__/stock-adjust-race.test.ts (2 tests) 14ms
 ✓  store-unit  src/__tests__/inventory-auth.test.ts (4 tests) 13ms
 ✓  store-unit  src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 114ms
 ✓  store-unit  src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 123ms

 Test Files  49 passed (49)
      Tests  608 passed (608)
   Start at  17:59:05
   Duration  12.21s (transform 4.72s, setup 0ms, collect 16.29s, tests 6.75s, environment 7.66s, prepare 32.47s)
```

### 4.3 `pnpm run typecheck`
```text
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
