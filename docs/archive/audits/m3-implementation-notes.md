# M3a implementation notes

Branch `m3a/counter-sale`. Spec: `docs/tasks/warehouse-m3-counter-sale.md`. Design note (approved
2026-11-11): `docs/design-notes/m3-counter-sale.md`. M3b (offline queue) is not started.

## What was built

| Spec §17 item | Where |
|---|---|
| 2. §12 fixes | Earlier, in #7 and #9; the two leftover parts landed here (`counter_sale` reference type, `STAFF_TABLES`) |
| 3. Migrations | `supabase/migrations/20261111120000` … `20261111120700` (eight files, each under 200 lines) |
| 4. API layer | `lib/api-spec/openapi.yaml` (counter and bundle paths), regenerated `lib/api-zod`, `lib/api-client-react` |
| 5. API routes | `routes/admin/counter-lookup.ts`, `counter-sales.ts`, `bundles.ts`; shared `middlewares/requireStaffOrAdmin.ts` |
| Pricing (design note Q3) | `lib/counter-pricing` — one module for screen and Express |
| 6. UI | `pages/admin/CounterPage.tsx` (+ `components/admin/counter/*`), `CounterSalesPage.tsx`, `CounterReceiptPage.tsx`, `BundlesPage.tsx`; nav and az/en/ru labels |
| 7. Tests | Unit: `artifacts/store/src/__tests__/counter-pricing.test.ts`. Integration: `artifacts/api-server/tests/m3a-counter-ledger.integration.test.ts`, `m3a-counter-routes.integration.test.ts` |
| 8. Invariants | §12.3 and §12.5 landed in #9; the four new tables joined `STAFF_TABLES` |

The new types in `artifacts/supabase-types/src/database.types.ts` were taken from the live test
project's generated types (Supabase MCP `generate_typescript_types`). Only the four tables and four
functions were inserted. Regenerating the whole file would have changed unrelated, hand-maintained
entries.

## Verification

Run locally on the branch tip, Windows, Node 24:

```
pnpm run typecheck                 → all packages "Done", exit 0
pnpm run test:unit                 → Test Files 61 passed (61), Tests 686 passed (686)
pnpm run audit:invariants:strict   → All invariant checks passed.
```

**Migrations.** The eight migrations were applied by hand, in one transaction, to the test project
`jcvsnoiacrknzejouxah`, which has rows. Verified live afterwards:
- the four tables and four functions exist;
- `product_variants_on_hand_check` is gone;
- the reference-type CHECK includes `counter_sale`;
- the margin report contains the counter CTE;
- `anon` and `authenticated` hold no `EXECUTE` on the new functions.

No empty-database run is available locally (`migrations.md` asks for both). That remains unverified.

**Integration and E2E.** These tiers run only in CI and were **not run locally**. The integration
tests are the first real execution of the three plpgsql functions and the new margin report.

## Found by the first CI run

`get_margin_report` had never worked on the test project. It selected `p.title`, `p.category_id`
and `c.name`, but the real schema keeps titles in `product_translations` and categories in
`product_categories` / `category_translations`. Every call failed with `42703`. The M2a version had
the same columns, so the margin report has been broken since M2a on any database built like the
test project. Migration `20261111120800` fixes the final SELECT. Before it was applied, its query
was run read-only against the test project and returned 13 titled rows. The void test used to pass
on an empty (failed) report; both report tests now assert that the call itself succeeded.

## Gaps closed later (branch `m3a/test-gaps`)

- **`allow_negative_stock = true` oversell:** `artifacts/api-server/tests/serial/m3a-negative-stock.serial.test.ts`
- **`posted_after_count`:** `artifacts/api-server/tests/m3a-counter-ledger.integration.test.ts` (`describe("posted_after_count")`)
- **E2E of the counter screen:** `artifacts/store/tests/e2e/counter-sale.spec.ts`

## Debt left on purpose

- `requireStaffOrAdmin` is still copied in six M2 route files. Only the M3 routes use the shared
  middleware (audit A9).
- Bundle line replacement is delete-then-insert in two statements, marked with a `ponytail:` comment
  in `routes/admin/bundles.ts`.
- Reservation creation can still over-reserve (design note §7, finding 8). This is outside M3a.
