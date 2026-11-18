# Phase M2b — Third Fix Pass Notes: Stocktake Integrity, Resolution Override & Cost Replay

**Date:** 2026-11-04  
**Branch:** `m2b/stocktake`  
**Prompt:** `prompts/m2b-fix-3.md`  
**Audit Reference:** `docs/audits/m2b-stocktake-audit.md`  

---

## 1. Executive Summary

Following the adversarial review in `docs/audits/m2b-stocktake-audit.md`, this fix pass resolves seven critical findings (F1 through F7) spanning posting date defaults, multi-counter conflict resolution snapshot binding, variance screen consistency, staleness detection on edited lines, unauthorized mutations of posted stocktakes, cost replay denominator safety on negative opening balances, and distinct error code assignment.

Each finding was implemented in a dedicated commit in strict order (F1 through F7). All tests passed, typechecking passed, and strict invariant checks passed with an empty baseline.

---

## 2. Breakdown of Changes per Finding

### 2.1 F1 — Every Stocktake is Unpostable [Blocker]
- **Commit:** `ab32050 fix(inventory): allow draft stocktakes with null posting_date and record posting moment on post (F1)`
- **Problem:** `public.stocktakes.posting_date` defaulted to `now()` on draft creation. Lines scanned after draft creation had snapshots with later timestamps (`captured_at > posting_date`), causing the backdating guard (`ST010`) to trigger unconditionally on every stocktake.
- **Changes:**
  - Added migration `supabase/migrations/20261104160000_m2b_posting_date_nullable.sql` dropping `DEFAULT` and `NOT NULL` on `public.stocktakes.posting_date`.
  - Updated RLS tenant isolation policy on `stocktakes` to use `(posting_date IS NULL OR posting_date <= now())` / `IS NOT DISTINCT FROM`.
  - Redefined `post_stocktake` in the migration:
    - Set `v_effective_posting timestamptz := COALESCE(v_st.posting_date, now());`.
    - Executed the `ST010` backdating guard **only** when `v_st.posting_date IS NOT NULL`.
    - Inserted stock movements with `occurred_at = v_effective_posting`.
    - Passed `v_effective_posting` to `recompute_variant_cost`.
    - Set `posting_date = v_effective_posting` on step 8 when updating the stocktake status to `posted`.
  - Updated `supabase/schema.sql`, `artifacts/supabase-types/src/database.types.ts`, and `lib/api-spec/openapi.yaml` (making `posting_date` nullable), running Orval codegen.
- **Tests Added (`artifacts/store/src/__tests__/stocktake-posting-integrity.test.ts`):**
  - Ordinary flow (null `posting_date` on draft) captures lines and posts cleanly with the posting moment recorded.
  - Explicit owner-supplied `posting_date` earlier than a line snapshot still raises `ST010`.

---

### 2.2 F2 — Override Measured Against Wrong Snapshot [Blocker]
- **Commit:** `7beb5f9 fix(inventory): measure stocktake override against chosen line snapshot to preserve interleaved sales (F2)`
- **Problem:** Lateral snapshot joins selected the latest contributing line's snapshot. When an owner resolved with `override` selecting an earlier line, the counted quantity was paired with a later line's snapshot, erasing intervening sales between the two scans.
- **Changes:**
  - In `supabase/migrations/20261104160000_m2b_posting_date_nullable.sql` inside `post_stocktake` (`reconciled` CTE):
    - When resolution type is `override`, joined `public.stocktake_line_snapshots stls` explicitly on `stls.line_id = sr.chosen_line_id`.
    - Added guard raising `ERRCODE = 'ST013'` if `chosen_line_id` is null on an `override` resolution.
    - When resolution type is `sum` or default unresolved, retained the latest contributing line's snapshot.
  - In `artifacts/api-server/src/lib/stocktake-variance.ts`:
    - Updated variance calculation to lookup `chosen_line_id` snapshot on `override`, falling back to latest line for other resolutions.
- **Tests Added (`artifacts/store/src/__tests__/stocktake-posting-integrity.test.ts`):**
  - Sequence: count 10 at 10:00, 2 units sold (on-hand 8), rescan 6 at 12:00, resolve with `override` picking line 1 $\rightarrow$ on-hand ends at 8 (not 10).
  - Sequence: resolve with `sum` $\rightarrow$ verifies latest line snapshot is used.

---

### 2.3 F3 — Variance Screen Contradicts Posting Behaviour [Blocker]
- **Commit:** `9113e78 fix(inventory): compute opening count variance against snapshot in review service (F3)`
- **Problem:** `stocktake-variance.ts` maintained a legacy conditional branch setting `varianceQty = countedQuantity` on opening counts, while `post_stocktake` computed delta as `(countedQuantity - snapshotOnHand)`. A legacy 10 counted at 4 displayed `+4` on screen but posted `-6`.
- **Changes:**
  - In `artifacts/api-server/src/lib/stocktake-variance.ts`, removed the opening count branch so `varianceQty` is always `Number((countedQuantity - snapshotOnHand).toFixed(3))`.
- **Tests Added (`artifacts/store/src/__tests__/stocktake-variance.test.ts`):**
  - Opening count with legacy on-hand 10 at cost 20, counted 4: asserts screen variance is `-6`, shrinkage value is `120`, and verifies the posted movement is `-6`.

---

### 2.4 F4 — Staleness Check Blind to Line Edits [Must]
- **Commit:** `0151277 fix(inventory): compare latest line change against resolution timestamp to detect edits (F4)`
- **Problem:** Conflict resolution staleness check compared `resolved_latest_line_at` against `MAX(created_at)`. Editing a counted quantity updates `updated_at` while keeping `created_at` unchanged, allowing typo edits after resolution to post stale quantities.
- **Changes:**
  - In `artifacts/api-server/src/routes/admin/stocktakes.ts`: computed `MAX(GREATEST(created_at, updated_at))` when storing `resolved_latest_line_at`.
  - In `artifacts/api-server/src/lib/stocktake-variance.ts`: checked staleness using `GREATEST(created_at, updated_at) > resolved_latest_line_at`.
  - In `supabase/migrations/20261104160000_m2b_posting_date_nullable.sql` inside `post_stocktake`: compared `MAX(GREATEST(created_at, updated_at)) > sr.resolved_latest_line_at`.
- **Tests Added (`artifacts/store/src/__tests__/stocktake-posting-integrity.test.ts`):**
  - Sequence: resolve at 10:10, counter edits line at 10:15 $\rightarrow$ posting raises `ST011`; re-resolving permits posting the updated quantity.

---

### 2.5 F5 — Staff Can Mutate Posted Stocktakes [Must]
- **Commit:** `05d3aa1 fix(inventory): prevent mutation of posted stocktakes and restrict draft deletion to admin (F5)`
- **Problem:** `stocktake-lines.ts` permitted staff line mutations via service-role client without verifying parent stocktake status, allowing deletion of snapshots on posted stocktakes. `DELETE /admin/stocktakes/:id` was accessible to staff.
- **Changes:**
  - In `artifacts/api-server/src/routes/admin/stocktake-lines.ts`:
    - In `PATCH /admin/stocktakes/:id/lines/:lineId` and `DELETE /admin/stocktakes/:id/lines/:lineId`, loaded parent stocktake status and rejected anything other than `draft` with 400 naming the status.
  - In `artifacts/api-server/src/routes/admin/stocktakes.ts`:
    - Enforced `draft` check on `PATCH /admin/stocktakes/:id`.
    - Changed `DELETE /admin/stocktakes/:id` authorization from `requireStaffOrAdmin` to `requireAdmin`.
  - In `scripts/audit/check-invariants.mjs`:
    - Added executable invariant `stocktake-mutations-check-draft-status` ensuring routes mutating `stocktake_lines` or `stocktakes` enforce status checks.
- **Tests Added (`artifacts/store/src/__tests__/stocktake-mutation-guards.test.ts`):**
  - Staff token patching line on posted stocktake gets 400.
  - Staff token deleting line on posted stocktake gets 400.
  - Staff token patching line on draft stocktake succeeds.
  - Staff token deleting stocktake gets 403 (requires admin).

---

### 2.6 F6 — Negative Opening Balance Divide-by-Zero in Cost Replay [Must]
- **Commit:** `f0c3b0c fix(inventory): clamp cost basis on negative opening balance and guard against division by zero (F6)`
- **Problem:** In `recompute_variant_cost`, an opening count posting a negative delta assigned `v_basis_qty := v_m.quantity_delta` when basis $\le 0$. A subsequent receipt of matching quantity resulted in a denominator of `(-X) + X = 0`, causing fatal division by zero.
- **Changes:**
  - Added migration `supabase/migrations/20261104170000_m2a_replay_negative_basis.sql` redefining `recompute_variant_cost`:
    - Clamped opening balance basis: `v_basis_qty := GREATEST(0, v_basis_qty + v_m.quantity_delta)`.
    - In the inbound-receipt branch, added denominator guard: when `v_basis_qty + v_m.quantity_delta <= 0`, treated receipt as a fresh basis (`v_avg_cost := v_unit_cost` and `v_basis_qty := GREATEST(0, v_m.quantity_delta)`) avoiding division by zero.
  - Updated TypeScript test costing engine simulation in `artifacts/store/src/__tests__/costing-engine-replay.property.test.ts`.
- **Tests Added (`artifacts/store/src/__tests__/costing-engine-replay.property.test.ts`):**
  - Audit sequence: legacy unvalued 10, opening count to 4 (delta `-6`), followed by receipt of 6 at 30 $\rightarrow$ succeeds cleanly without division by zero and sets average cost to 30.

---

### 2.7 F7 — Two Conditions Shared Error Code ST010 [Must]
- **Commit:** `3e84355 fix(inventory): assign dedicated ST012 error code to missing snapshot posting guard (F7)`
- **Problem:** Error code `ST010` was used for both backdated posting dates and missing count line snapshots.
- **Changes:**
  - Updated missing snapshot guard in `post_stocktake` (`supabase/migrations/20261104160000_m2b_posting_date_nullable.sql`) to raise `ERRCODE = 'ST012'`.
  - Preserved `ST010` strictly for backdated `posting_date < snapshot.captured_at`.
  - Updated test assertions in `artifacts/store/src/__tests__/stocktake-posting-integrity.test.ts` to expect `ST012` for missing snapshots.

---

## 3. Justifications for File Length Over 200 Lines

Per `AGENTS.md`, any file over 200 lines must be documented with the reason for its length:
1. `supabase/migrations/20261104160000_m2b_posting_date_nullable.sql` (292 lines):  
   This migration replaces the stored procedure `post_stocktake` in its entirety. It includes all pre-flight invariant validations (`ST010`, `ST011`, `ST012`, `ST013`), resolution snapshot branching logic, movement ledger insertions, variant cost recomputation calls, and document finalization. Defining the full function within a single migration guarantees atomic, reproducible database deployment.
2. `supabase/migrations/20261104170000_m2a_replay_negative_basis.sql` (214 lines):  
   This migration redefines `recompute_variant_cost` in its entirety. Carrying the complete function body ensures that historical movement replay, weighted average calculations, and newly clamped basis/receipt division guards remain atomic without partial definitions across migration steps.

---

## 4. Observations on Prompt Instructions

All instructions in `prompts/m2b-fix-3.md` were implemented exactly as prescribed. Notes and observations during implementation:
- **F5 Invariant Guard:** The executable invariant `stocktake-mutations-check-draft-status` was added to `scripts/audit/check-invariants.mjs` using AST/pattern inspection of Express router mutations in `artifacts/api-server/src/routes/admin/` to ensure calls against `stocktake_lines` and `stocktakes` verify parent status.
- **F6 Cost Basis for Unvalued Opening Balance:** In `recompute_variant_cost`, unvalued opening balance movements flag `has_unknown := true` without setting `v_avg_cost` or altering `v_basis_qty`. Basis clamping `GREATEST(0, v_basis_qty + delta)` was applied to valued opening balances and cleanly integrated into both PL/pgSQL and the Vitest test simulation.

---

## 5. Command Output Verification

### 5.1 `pnpm run audit:invariants:strict`
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
ok    stocktake-mutations-check-draft-status 0 total, 0 new

All invariant checks passed.
```

### 5.2 `pnpm run test:unit`
```text
> workspace@0.0.0 test:unit C:\Users\user\Documents\ecommerce-latest
> vitest --run --project store-unit --project env-validation

 DEPRECATED  The workspace file is deprecated and will be removed in the next major. Please, use the `test.projects` field in the root config file instead.

 RUN  v3.2.6 C:/Users/user/Documents/ecommerce-latest

 ✓  store-unit  src/lib/settings/cms-rendering.property.test.ts (14 tests) 638ms
 ✓  store-unit  src/__tests__/heading-hierarchy.property.test.ts (8 tests) 119ms
 ✓  store-unit  src/__tests__/cart-validation.test.ts (25 tests) 301ms
 ✓  store-unit  src/__tests__/image-proxy.property.test.ts (5 tests) 174ms
 ✓  store-unit  src/lib/settings/theme-engine.property.test.ts (4 tests) 152ms
 ✓  store-unit  src/__tests__/order-tracking.property.test.ts (6 tests) 567ms
 ✓  store-unit  src/__tests__/translated-field.property.test.ts (3 tests) 284ms
 ✓  store-unit  src/__tests__/admin-list.property.test.ts (7 tests) 331ms
 ✓  store-unit  src/__tests__/i18n-consistency.test.ts (16 tests) 193ms
 ✓  store-unit  src/__tests__/i18n-split.property.test.ts (2 tests) 253ms
 ✓  store-unit  src/__tests__/admin-components.property.test.ts (6 tests) 363ms
 ✓  store-unit  src/pages/admin/settings/validate-settings.property.test.ts (14 tests) 972ms
 ✓  store-unit  src/__tests__/costing-engine-replay.property.test.ts (4 tests) 93ms
 ✓  store-unit  src/__tests__/allow-negative-stock.test.ts (9 tests) 32ms
 ✓  store-unit  src/__tests__/i18n-hardcoded-strings.test.ts (120 tests) 126ms
 ✓  store-unit  src/lib/settings/context.test.ts (32 tests) 89ms
 ✓  store-unit  src/__tests__/stocktake-posting-integrity.test.ts (19 tests) 24ms
 ✓  store-unit  src/__tests__/image-proxy.unit.test.ts (25 tests) 30ms
 ✓  env-validation  tests/env-validation.test.ts (9 tests) 205ms
 ✓  store-unit  src/__tests__/brand-marquee.test.ts (8 tests) 1255ms
   ✓ Property 9: Marquee Rendering Correctness > each brand link href uses encodeURIComponent on brand name with correct locale prefix  487ms
 ✓  store-unit  src/__tests__/stocktake-variance.test.ts (24 tests) 177ms
 ✓  store-unit  src/__tests__/admin-logic.test.ts (32 tests) 355ms
 ✓  store-unit  src/__tests__/i18n-preservation.test.ts (36 tests) 24ms
 ✓  store-unit  src/__tests__/admin-components.test.ts (17 tests) 164ms
 ✓  store-unit  src/lib/settings/storefront-rendering.property.test.ts (11 tests) 3027ms
   ✓ Feature: white-label-customization, Property 18: Navigation links show only qualifying pages in sort order > header navigation includes exactly published pages with show_in_header=true, sorted by sort_order ascending  544ms
   ✓ Feature: white-label-customization, Property 18: Navigation links show only qualifying pages in sort order > unpublished pages are never included regardless of nav flags  354ms
   ✓ Feature: white-label-customization, Property 18: Navigation links show only qualifying pages in sort order > pages with show_in_header=false are excluded from header nav even if published  549ms
   ✓ Feature: white-label-customization, Property 18: Navigation links show only qualifying pages in sort order > pages with show_in_footer=false are excluded from footer nav even if published  500ms
 ✓  store-unit  src/__tests__/receiving-cost-integrity.test.ts (5 tests) 18ms
 ✓  store-unit  src/__tests__/m1-schema-additions-migration.test.ts (5 tests) 26ms
 ✓  store-unit  src/__tests__/queries.test.ts (14 tests) 77ms
 ✓  store-unit  src/lib/settings/theme-engine.test.ts (15 tests) 21ms
 ✓  store-unit  src/__tests__/staff-cost-reachability.test.ts (6 tests) 23ms
 ✓  store-unit  src/__tests__/barcode-matrix-resolution.test.ts (4 tests) 36ms
 ✓  store-unit  src/__tests__/barcode-pack-quantity.test.ts (6 tests) 80ms
 ✓  store-unit  src/__tests__/fixtures.test.ts (7 tests) 18ms
 ✓  store-unit  src/lib/settings/default-rendering.test.ts (17 tests) 65ms
 ✓  store-unit  src/__tests__/stocktake-reconciliation.test.ts (4 tests) 13ms
 ✓  store-unit  src/pages/admin/SettingsPage.test.ts (22 tests) 27ms
 ✓  store-unit  src/__tests__/variant-costs-lifecycle.test.ts (5 tests) 14ms
 ✓  store-unit  src/__tests__/stocktake-mutation-guards.test.ts (7 tests) 16ms
 ✓  store-unit  src/__tests__/admin-i18n.property.test.ts (2 tests) 188ms
 ✓  store-unit  src/__tests__/adjustment-role-guards.test.ts (4 tests) 20ms
 ✓  store-unit  src/components/admin/ImageCandidateGrid.test.ts (9 tests) 19ms
 ✓  store-unit  src/__tests__/stock-adjust-race.test.ts (2 tests) 15ms
 ✓  store-unit  src/__tests__/unit-cost-privacy.test.ts (3 tests) 17ms
 ✓  store-unit  src/__tests__/m2a-admin-ui-components.test.ts (7 tests) 17ms
 ✓  store-unit  src/__tests__/blind-counting-security.test.ts (4 tests) 15ms
 ✓  store-unit  src/__tests__/margin-report-granularity.test.ts (3 tests) 15ms
 ✓  store-unit  src/__tests__/inventory-auth.test.ts (4 tests) 8ms
 ✓  store-unit  src/__tests__/storefront-ux.property.test.ts (25 tests) 7448ms
   ✓ Property 3: Quick View addItem uses correct variant data > for products with variants, addItem uses the selected variant's price and label  4818ms
   ✓ Property 3: Quick View addItem uses correct variant data > variant selection never changes the product_id or image  466ms
 ✓  store-unit  src/__tests__/login-modal-profile-reroute.test.ts (2 tests) 184ms
 ✓  store-unit  src/__tests__/coupons-page-admin-fetch.test.ts (3 tests) 181ms

 Test Files  50 passed (50)
      Tests  641 passed (641)
   Start at  20:49:15
   Duration  16.80s (transform 15.48s, setup 0ms, collect 46.43s, tests 18.51s, environment 7.43s, prepare 50.94s)
```

### 5.3 `pnpm run typecheck`
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
artifacts/store typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck$ tsc -p tsconfig.json --noEmit
artifacts/api-server typecheck: Done
artifacts/store typecheck: Done
```
