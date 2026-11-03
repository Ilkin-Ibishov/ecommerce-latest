# M1 Defect Fixes (Fix-2) & Branch Completion Notes

Branch: `m1/variants-ledger`  
Task: `prompts/m1-fix-2.md`  
Date: 2026-11-03  

---

## 1. Executive Summary

This document verifies the resolution of the final two defects identified on the `m1/variants-ledger` branch prior to merge:
1. **G1 [must]**: The `posting_date` backfill in migration `20261103210000_m1_schema_additions.sql` now follows the standard four-step pattern so existing records on populated databases inherit their historical `created_at` timestamp rather than the migration execution time.
2. **G2 [must]**: Shared barcode resolution (Scenario S2) in `POST /api/admin/stock/adjust` no longer silently picks candidate `bRows[0]`. If `variant_id` is omitted for a shared barcode, the endpoint rejects with HTTP 400 naming the candidates. When `variant_id` is provided, `pack_quantity` is read strictly from that variant's barcode row.

Both fixes are verified by automated tests. All invariants, typechecks, and unit test suites are green.

---

## 2. G1 — Migration `posting_date` Four-Step Backfill

### Root Cause
Adding a column with `ADD COLUMN ... NOT NULL DEFAULT now()` in PostgreSQL immediately stamps all existing rows with the current timestamp (`now()`). Any subsequent `UPDATE ... WHERE posting_date IS NULL` matches zero rows. On a populated ledger, all historical movements would share the migration execution timestamp, corrupting the business order required for weighted-average cost replay in M2.

### Remediation
Replaced the single `ADD COLUMN` statement in `supabase/migrations/20261103210000_m1_schema_additions.sql` with the standard four-step DDL pattern:
1. `ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS posting_date timestamptz;` (nullable, no default; existing rows receive NULL)
2. `UPDATE public.stock_movements SET posting_date = created_at WHERE posting_date IS NULL;` (backfills existing records from their true historical `created_at`)
3. `ALTER TABLE public.stock_movements ALTER COLUMN posting_date SET NOT NULL;` (locks the column against NULLs)
4. `ALTER TABLE public.stock_movements ALTER COLUMN posting_date SET DEFAULT now();` (establishes default for subsequent insertions)

### Verification
- **Unit Test**: Added `G1: pre-existing movements receive posting_date = created_at and not the migration run time` in `artifacts/store/src/__tests__/m1-schema-additions-migration.test.ts`. Confirms historical records preserve their creation date (`2025-06-15T10:00:00.000Z`) and do not take the migration timestamp (`2026-11-03T21:00:00.000Z`).
- **DDL Assertions**: Updated `artifacts/api-server/tests/variants-ledger-rls.test.ts` to assert all four migration steps are present.

---

## 3. G2 — Shared Barcode Disambiguation in Stock Adjustment

### Root Cause
Scenario S2 (docs/tasks/identification-scenario-matrix.md) allows one supplier barcode to be shared across multiple variants (e.g. same mug in multiple colours). In `artifacts/api-server/src/routes/inventory.ts`, `POST /admin/stock/adjust` previously executed:
```ts
if (!variant_id) variant_id = bRows[0].variant_id;
const packQty = Number(bRows[0].pack_quantity ?? 1);
```
This produced two critical flaws:
1. With no `variant_id`, it guessed an arbitrary variant (`bRows[0]`) and posted movement silently.
2. When `variant_id` was provided, `packQty` was still read from `bRows[0]`, potentially applying the wrong pack size (e.g. piece vs 12-pack case).

### Remediation
Updated `artifacts/api-server/src/routes/inventory.ts`:
- If `!variant_id` and `bRows.length > 1`: Returns HTTP 400 rejecting the ambiguous adjustment and naming candidate IDs in `error` and `candidates`.
- If `!variant_id` and `bRows.length === 1`: Resolves `variant_id = bRows[0].variant_id`.
- When `variant_id` is supplied: Locates `matchedRow = bRows.find(r => r.variant_id === variant_id)`. If missing, rejects with HTTP 400. Otherwise, sets `packQty = Number(matchedRow.pack_quantity ?? 1)`.

### Verification
- **Unit Test**: Added `G2 Path 1` and `G2 Path 2` tests to `artifacts/store/src/__tests__/barcode-pack-quantity.test.ts`.
  - Path 1 verifies that scanning a shared barcode without `variant_id` throws with candidate IDs and leaves stock unchanged.
  - Path 2 verifies that selecting the second variant with pack size 12 records a movement delta of 12 (not 1 from candidate 0).
- **Route Mock**: Updated the endpoint simulation in `artifacts/api-server/tests/variants-ledger-rls.test.ts` and added integration tests for both paths.

---

## 4. Verification Suite Results

| Check | Command | Status | Details |
|---|---|---|---|
| Typecheck | `pnpm run typecheck` | Passed | 0 TypeScript errors across all 10 packages |
| Unit Tests | `pnpm run test:unit` | Passed | 39 test files, 549 unit tests passed |
| Strict Invariants | `pnpm run audit:invariants:strict` | Passed | 0 total, 0 new violations across all 5 checks |

---

## 5. Branch Completeness Assessment

The `m1/variants-ledger` branch is complete and ready to merge into `main`:
1. **Core Data Model & Ledger**: Append-only `stock_movements` ledger with `trg_apply_stock_movement` maintaining `product_variants.on_hand` and preventing negative inventory.
2. **Identification Scenario Matrix (S1-S5)**: `variant_barcodes` table with unique `(variant_id, barcode)` constraint and multi-variant scan lookup.
3. **M1 Schema Additions (A1-A4)**: `posting_date`, `transaction_id`, `correlation_id`, `pack_quantity`, `pack_unit`, `track_stock`, and `low_stock_threshold` are fully migrated, typed, and wired into API endpoints.
4. **Defect Resolutions (G1 & G2)**: Populated database backfill safety verified; shared barcode disambiguation enforced.
5. **No Unfinished Work Remaining on M1**: All deferred items (`rebuild_on_hand`, optimistic concurrency for stocktake counts, `allow_negative_stock` policy setting, and UOM immutability) are not backfill-sensitive and are formally scheduled for Milestone 2.
