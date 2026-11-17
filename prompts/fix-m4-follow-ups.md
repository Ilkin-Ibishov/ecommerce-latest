# M4 follow-ups — three recorded minors

Read `AGENTS.md`, `.agents/rules/express5-api.md`, `.agents/rules/frontend.md` and
`.agents/rules/testing.md`. Branch `fix/m4-follow-ups`, cut from `main` at `711781c`; it is checked
out. Never commit to `main`. Do not push. Do not touch any Supabase project, do not run SQL, do not
add or edit any file under `supabase/`.

The M4 audit recorded minors that were not fixed. This round fixes three that need no database
change. Three changes, one commit each. Nothing else: do not refactor nearby code.

Line numbers are for `main` at `711781c`.

## 1. The four signal settings are seeded and never read

`supabase/migrations/20261113231300_m4_store_settings_signals.sql:12-15` seeds `store_settings` rows
`dead_stock_days` ('90'), `reorder_target_days` ('60'), `reorder_velocity_window_days` ('28'),
`reorder_min_sales` ('3'). `artifacts/api-server/src/routes/admin/inventory-signals.ts` hard-codes
those numbers (`:99`, `:101`, `:150`, `:180-182`), so changing a setting changes nothing.

In `inventory-signals.ts` only:

- Add one exported pure function `parseSignalSettings(rows: { key: string; value: string }[])` that
  returns `{ deadStockDays, reorderTargetDays, reorderWindowDays, reorderMinSales }`. Each value is the
  row's value when `Number(value)` is an integer ≥ 1, otherwise the default 90 / 60 / 28 / 3. A
  missing row gives the default.
- Add one async helper in the same file that selects `key, value` from `store_settings` for those four
  keys with the service client (`getAdminSupabase()`, as the file already does) and returns
  `parseSignalSettings(data ?? [])`. On a query error, log it with `(req.log || logger).error` the way
  `parseSignals` does and use the defaults. No empty `catch {}` — the invariant
  `signals-have-one-derivation` forbids it in this file, and forbids moving this code to a file under
  `artifacts/api-server/src/lib/` whose path contains `inventory-signals`. Keep it in the route file.
- Summary route (`:92-127`): use the four settings instead of `90`, `28`, `60`, `3`.
- Dead-stock route (`:148-175`): `days` is the query parameter when present and a valid integer ≥ 1,
  otherwise `deadStockDays`. Add `days` (the effective number) to **both** JSON responses (admin and
  staff).
- Reorder route (`:178-198`): each of `windowDays`, `targetDays`, `minSales` is the query parameter
  when present and valid, otherwise the setting.
- Do not reshape `lowStockRowSchema`, `deadStockRowSchema`, `reorderSuggestionRowSchema`:
  `artifacts/store/src/__tests__/invariant-stock-signals-schema.test.ts` parses those blocks.

`artifacts/store/src/pages/admin/InventoryPage.tsx`: the page starts with `notSellingDays = 90` (`:79`)
and always sends `?days=` (`:97`), which would bypass the setting.

- Make the state `number | null`, initial `null`. Send `?days=…` only when it is not `null`.
- When the response arrives (`:99-103`) and the state is `null`, set it from `data.days` when that is a
  number. The buttons `[30, 60, 90, 180]` (`:413`) stay and behave as now.

Test (offline): new file `artifacts/store/src/__tests__/signal-settings.test.ts` importing
`parseSignalSettings` — if the store unit project cannot import from `artifacts/api-server/src` (check
how `artifacts/store/src/__tests__/invariant-stock-signals-schema.test.ts` reaches that file; it reads
it as text), stop on the test, say so in the notes, and do not move the function. Cases: all four rows
valid → those values; empty list → defaults; `"0"`, `"-5"`, `"abc"`, `""`, `"2.5"` → the default for
that key; an unknown key is ignored.

## 2. The inventory page shows stale numbers when its requests fail

`artifacts/store/src/pages/admin/InventoryPage.tsx`, `loadData` (`:115-190`): when
`GET /admin/inventory/availability` fails or is not ok (`:130-138`), every product is rendered from
`products.stock` (`:166-169`), a legacy column that is 0 for every product created since M1 — wrong
numbers with no sign of failure. The low-stock request (`:154-162`) fails the same way, and
`lowStockProductIds.size > 0 ? … : <available < 10>` (`:204-206`, `:216-218`) treats "request failed"
and "nothing is low" as the same thing.

- Add a `loadError` boolean state. In `loadData`: reset it at the start; if either request rejects or
  is not ok, set it, `setLoading(false)` and return without calling `setProducts`.
- When `loadError` is true render, instead of the table and the stat cards, a short message with a
  retry button that calls `loadData`. Use the existing keys `Admin.Common.networkError` and
  `Admin.Common.retry` (confirm both exist in `az.ts`, `ru.ts`, `en.ts`; if not, stop on this item).
- `:166-169`: remove the `p.stock` fall back. A product with no row in the availability map shows
  `on_hand` 0, `reserved` 0, `available` 0, `deficit` 0.
- `:204-206` and `:216-218`: remove the `< 10` branches; the low-stock count and filter use
  `lowStockProductIds` only.
- Leave the `products` query (`:118-121`) and the `healthy` definitions (`:207`, `:221`) as they are.
- `artifacts/store/src/__tests__/m4-stock-signals-ui.test.ts:35-45` holds a local copy of the old
  low-stock filter with the `< 10` fall back. Update that copy and its cases to the new rule and name
  the change in the notes under "tests changed".

## 3. A cost-privacy test that passes when its fixture is missing

`artifacts/api-server/tests/m4-stock-signals.integration.test.ts:120-124` and `:131-135` wrap the
assertions in `if (staffVar)` / `if (adminVar)`. If the fixture row is not returned, nothing is
asserted. Replace each `if` with `expect(staffVar).toBeDefined();` / `expect(adminVar).toBeDefined();`
followed by the same property assertions, unconditional. This strengthens a test; say so in the notes.
You cannot run this tier. If you believe the fixture (`:111-113`) would not be returned at `days=90`,
do not weaken the assertion: say why in the notes.

## What you must not do

- No migration, no change to `artifacts/supabase-types`, no change to the dashboard page, no settings UI.
- No `@ts-ignore`, no new `as any`, no `.skip()`, no deleted test, no new dependency.

## Notes

Write `docs/audits/fix-m4-follow-ups-notes.md`: what changed per item; tests added, changed,
strengthened, deleted or weakened, by name; **Blocked / Assumptions / Not verified** (the integration
tier was not run by you — say so; nothing was run in a browser — say so); the real output of
`pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants`. If a line number, name or key
above is wrong against the code, stop on that item and say so instead of guessing a different fix.

## Done means

The three local commands pass. Three commits (`fix(inventory): …`, `test(inventory): …`), plus one
`docs(audit): …` commit for the notes.
