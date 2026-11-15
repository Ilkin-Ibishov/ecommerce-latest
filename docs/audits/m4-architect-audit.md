# Audit — M4 stock signals

2026-11-14, architect pass. Branch `m4/stock-signals` at `c1d569b`, against
`docs/tasks/warehouse-m4-stock-signals.md`. Inputs: the spec, `git diff main...HEAD`, the invariant
list, and read-only queries on the test project (`jcvsnoiacrknzejouxah`). The design note and the
builder's own QA reports were not used as evidence.

**Verdict: rejected as one branch. Not mergeable, and not fixable in place.** Two blockers in M4
itself, one security blocker in work that is not M4, and the branch carries roughly three phases of
unrelated change. Split it (§5), then fix M4 on its own.

This is one architect's reading. It is not the independent adversarial audit from a different model
family that the process calls for; that still has to run, once, on the split M4 branch.

## 1. Process

- **The design-note gate did not hold.** Note committed 21:20, amended 21:28 "addressing verifier audit
  findings", first migration 21:47. No architect review happened in those 27 minutes.
- **No M4 migration has ever executed.** On the test project `low_stock_notification_events` does not
  exist, `post_counter_sale` has no `track_stock`, and the availability view has its M2c columns. Spec
  §16 requires every migration applied to the test project.
- **So every figure in the builder's black-box QA came from the TypeScript fallback (M1), not from the
  SQL.** The three RPCs, the trigger change and the four sale functions are untested code.
- `docs/audits/m4-implementation-notes.md` (spec §16) does not exist.
- The branch is 224 files, +9710/−1160. M4 as specified is about a fifth of that.

## 2. Blockers

### B1. Any signed-in shopper can become staff or admin — `requireStaffOrAdmin.ts:18`

```ts
const rawRole = profile?.role || user.app_metadata?.role || user.user_metadata?.role;
```

New on this branch; `main` reads `public.users.role` only. `user_metadata` is writable by the user
themselves: `supabase.auth.updateUser({ data: { role: "admin" } })` with their own session and the
public anon key. Whenever `profile?.role` is falsy — no `public.users` row, or a null role — that
value is accepted, and the middleware then hands the request the service-role client.

Ordinary flow: a row with a role exists, so the fallback is dead code. It meets the earlier decision
that `public.users.role` is the only source of authority; `auth.ts:98` and `bootstrap.ts` upsert that
row without the request depending on it having succeeded, and `handle_new_user` exists only in
`schema.sql`, not in the migrations. One failed upsert is one shopper who can promote themselves.

Not demonstrated end to end: no account without a `public.users` row was constructed. The code path
is unambiguous; the precondition's frequency is unknown.

Fix: delete both fallbacks. No row or no role is 403. `app_metadata` is not user-writable but is not
this product's source of truth either; do not keep it "to be safe". Becomes an invariant: no file
under `artifacts/api-server/src` reads `user_metadata.role` or `app_metadata.role`.

### B2. `20261113220000_m4_track_stock_trigger.sql` cannot apply

`CREATE OR REPLACE VIEW product_variant_availability` inserts `track_stock` as the sixth column. The
live view's columns are `variant_id, product_id, sku, price, on_hand, reserved_quantity,
available_quantity, deficit_quantity`. Postgres allows `CREATE OR REPLACE VIEW` to add columns only
at the end; this fails with 42P16 ("cannot change name of view column"). The trigger function is in
the same file, so the `track_stock` enforcement — the defect fix the phase leads with — does not land
either.

Established from the live column order and the documented rule; the statement itself was not run.

Fix: move `track_stock` to the end of the select list. Not `DROP VIEW`:
`product_variant_public_availability` depends on it.

### B3. `post_counter_sale` collides with the `counter_sale_payments` chore

Recorded in `docs/audits/chore-counter-sale-payments-audit.md` B3. Decision: the chore merges first;
M4 rebases onto it; `20261113220010` is re-timestamped after `20261113230400` and its
`post_counter_sale` carries the payment insert. M4's own invariant `no-non-tracked-variant-movements`
already fails on the chore's file once both are present — it works as designed and is the tripwire.

## 3. Major

### M1. Every signal is implemented twice, and the copies disagree

`routes/admin/inventory-signals.ts` calls each RPC and, on any error, falls through `catch {}` to a
TypeScript re-implementation in `lib/inventory-signals-*.ts` (313 lines). The low-stock fallback counts
every `active` reservation; the RPC and the view exclude expired ones. A variant with an expired hold
is low in one path and fine in the other, and nothing tells the caller which path answered.

This is the phase's own invariant turned inside out: a signal with two derivations can disagree with
itself. It also hides a missing migration instead of failing on it, which is why §1's third point went
unnoticed. Fix: delete the fallback libs. An RPC error is a 500.

### M2. The low-stock digest is never evaluated and never shown

`POST /admin/inventory/signals/evaluate-digest` has no caller outside tests: no schedule, no hook on a
sale, no button. If it were called, it writes a `notifications` row with `channel = 'in_app'`,
`recipient = 'admin'`, `user_id = null`, and no reader of such a row was found in the store. The
dispatch branch is `result = { ok: true }`. Spec §6.4 and deliverable 5 are not delivered; what exists
is the suppression table and a route.

Also in that route: no step checks its `error`. If the suppression insert fails the digest is still
sent, and is sent again on every call — the exact noise §6.4 exists to prevent.

Decide in a revised design note where the digest runs and where the owner sees it, before more code.

### M3. A variant switched to non-tracked breaks what already happened to it

The trigger rejects every movement for a `track_stock = false` variant, and nothing guards the switch.

- Sell a tracked variant, then mark it non-tracked: `void_counter_sale` inserts the reversing movement,
  gets ST030, and the sale can no longer be voided.
- Mark a variant non-tracked while it is on an open stocktake: posting the correction raises ST030 and
  the whole stocktake fails to post.
- `on_hand` freezes at whatever it was; no movement can ever correct it.

Ordinary flow: a variant is created non-tracked and never changes — fine. Intersections: M3a void, M2b
stocktake posting, M1 "stock changes only through the ledger". Spec §9 bullets 4 and 5 (bundle
availability over tracked components; non-tracked variants absent from count sheets) are not
implemented at all — no stocktake or bundle code reads the flag.

Fix direction: refuse the true→false switch while `on_hand <> 0` or the variant is on an open
stocktake; let a reversal of an existing movement through. Design note first.

### M4. 76 new `as any`

`AGENTS.md` deny list. `m4-stock-signals.integration.test.ts` 23, `DashboardPage.tsx` 16,
`routes/admin/users.ts` 8, the signals route and libs 17. `main` already carries 363 in the same
trees, so this is the house habit and not a new one — but many of these exist because
`database.types.ts` was not regenerated for the new RPCs and table. Regenerate, then remove what
remains.

## 4. Minor

- **m1.** Non-tracked availability is the literal `999999`, and it flows through
  `product_variant_public_availability` to `anon`. Any "only N left" display prints it. Return NULL for
  unlimited and handle NULL at the readers.
- **m2.** `has_enough_data` counts distinct transactions including fully voided ones. One real sale
  plus two voided ones shows a confident suggestion. Count transactions with net units > 0.
- **m3.** `'Unassigned'` is an English literal returned from SQL into a grouped, three-locale screen.
  Return NULL; label it in `t()`.
- **m4.** `needs_owner` sales are added to velocity from `counter_sale_lines` because they wrote no
  movement. That contradicts spec §5.2 and the spec's own §12 row, which wrongly says such a sale
  "consumed stock". The builder's reading is the defensible one; the spec needs a correction from the
  architect, and the deviation should have been raised rather than made silently.
- **m5.** `GET /admin/inventory/availability` returns `on_hand` to staff. Blind counting was already
  not tamper-proof (STATUS item 7); this makes the number one request away.
- **m6.** 8.7 MB of screenshots under `docs/audits/`. Evidence belongs in CI artifacts.
- **m7.** `scripts/audit/setup-m4-test-environment.ts` loads `artifacts/api-server/.env` and writes
  fixtures with the service-role key. Nothing records what it wrote to the test project, which now
  holds 231 counter sales.

## 5. What is not M4, and where it goes

| Commits | Content | Disposition |
|---|---|---|
| `27b6646` `7ea7cd7` `6c3919d` `fc71328` | Staff provisioning, three-role management, sole-admin guard, the middleware change (B1) | Own branch, own spec. It changes who holds authority; it gets its own audit |
| `2a92d46` | Counter confirmation modal, change calculator, direct quantity input | Own branch. Touches the till the payments chore says has no UI change |
| `4dbba30` `6487713` | Storefront mobile, checkout, SPA navigation fixes | Own branch; simple-task tier |
| `ca38231` `5ee69e9` `fa0abed` | Admin inventory and receipt fixes, new availability endpoint | Own branch |
| `43f6410` `bd5fae7` `ea870bf` `c1d569b` (docs, scripts) | Persona audits, QA scripts, screenshots | Keep the written reports; drop the images and the one-off scripts |

M4 proper is `49eafe6`…`506bbcf` plus `b632b5b`, and `b632b5b` is the fallback that M1 deletes.
None of the non-M4 commits was audited here beyond B1 and m5.

## 6. What holds

- The trigger change itself: the `track_stock` check precedes the existing logic and leaves the
  negative-stock and availability branches as M2c wrote them.
- The three RPCs are revoked from `public, anon, authenticated` and granted to `service_role` only.
- No stored signal column; the only stored state is what was notified. §4 is respected.
- Dead-stock cost is stripped in the API for staff, not in the component, and reorder is owner-only.
- Velocity is net of void reversals, which share the sale's `transaction_id` and `posting_date`.
- Dead stock uses first movement as the floor, so an opening-count variant is not dead on day one.
- No test was deleted or skipped. No `@ts-ignore`. No dependency, CI or workspace-config change.
- No variant on the test project has movements while non-tracked (one such variant, zero movements).

## 7. Tiers run for this audit

Locally at `c1d569b`: `pnpm run typecheck` — exit 0. `pnpm test:unit` — 709 tests, 64 files, all
pass. `audit:invariants` — pass. Integration and E2E: not run; they cannot be meaningful until the
migrations apply (B2). Passing unit tests here say little about the SQL: none of it has executed.

## 8. Next

1. Chore `counter_sale_payments` finishes its fix round and merges.
2. Architect splits this branch per §5. B1 is fixed on the staff-provisioning branch before anything
   from it merges.
3. Builder revises `docs/design-notes/m4-stock-signals.md` for M2 and M3 and **stops**.
4. After review: fix round on the split M4 branch (B2, B3, M1, M4, minors), migrations applied to the
   test project by hand, CI, then the one cross-family adversarial audit.

## Split — 2026-11-14, branch `m4/stock-signals-core`

Cut from `main` at `673e3ab` (chore `counter_sale_payments` merged). Cherry-picked, in order:
`49eafe6 3eef19a 2082e8f 3671707 0aefc55 7335179 eecb1cc 506bbcf`, then this document. Nothing else
from `m4/stock-signals` is here; that branch is untouched and still holds the non-M4 work of §5.

- One conflict, `scripts/audit/check-invariants.mjs`: both sides added checks. Resolved by keeping
  the chore's two and M4's one. No other file conflicted.
- `b632b5b` was not picked, so the TypeScript fallback libs do not exist on this branch and the
  signals route has no `catch`. **M1 is closed by the split.** The M4 QA scripts and screenshots
  (`c1d569b`, m6, m7) are not here either.
- 21 files, +3129/−590 against `main`.

Tiers run at the split: `typecheck` exit 0; `test:unit` 715 tests, 64 files, pass;
`audit:invariants` **fails, as intended**: `no-non-tracked-variant-movements` on
`20261113230400_post_counter_sale_payments.sql`. That is B3's tripwire: the chore's function sorts
last and has no `track_stock`. The fix is the builder's: a new migration after `…230400` whose
`post_counter_sale` carries both the payment insert and the `track_stock` filter, and M4's
`20261113220010` no longer redefining it.

Still open on this branch: B2, B3, M2, M3, M4 (`as any`), m1–m5. B1 is not on this branch; it lives
with the staff-provisioning commits on `m4/stock-signals` and must be fixed before those merge
anywhere. No M4 migration has run on Postgres.

Next is §8 step 3: the builder revises the design note for M2 and M3 and stops.

## Split of the non-M4 work — 2026-11-15

Done by sub-agents in their own worktrees; each result checked against git, not against the report.
All branches are cut from `main` at `673e3ab`. None is pushed, none is audited beyond what is said here.

| Branch | Holds | Local tiers | State |
|---|---|---|---|
| `fix/e2e-cart-flow-in-stock` | `67dfb26`: `cart-flow.spec.ts` opens the seeded `test-product-1` instead of the first listed product | typecheck, unit, invariants pass | E2E not run; needs one CI run |
| `feat/staff-provisioning` | `27b6646 7ea7cd7 6c3919d`, a middleware unit test, invariant `no-auth-metadata-role-reads` with fixtures | pass (711 tests, 65 files) | not mergeable, see below |
| `fix/counter-sale-confirmation` | `2a92d46`, patch-identical | pass (696 tests) | unaudited |
| `fix/storefront-mobile-spa` | `4dbba30 6487713`, patch-identical | pass (696 tests) | unaudited |

- **`fc71328` is not on any branch and will not be cherry-picked.** It is a 15-file mixed commit: it
  edits M4's `inventory-signals.ts`, adds a dashboard route, touches eleven other routes, adds an
  `as any`, and is the commit that introduces B1. So B1 exists only on `m4/stock-signals`, which does
  not merge. `feat/staff-provisioning` reads `profile?.role` only, and the new invariant keeps it so.
  The invariant is a line regex; a destructured read (`const { role } = user.user_metadata`) passes it.
- **`feat/staff-provisioning` is missing the sole-admin guard**, which was in `fc71328`. On the branch
  an admin cannot demote themselves (`routes/admin/users.ts:152`), but with two admins either can
  demote the other. It also carries six `as any` from the cherry-picked commits. It needs its own
  spec and audit (§5) before it goes anywhere.
- **`ca38231 5ee69e9 fa0abed` (admin inventory and receipt fixes) could not be split onto `main`.**
  `ca38231` conflicts in the three i18n dictionaries, `DashboardPage.tsx` and `UsersPage.tsx`: it sits
  on top of both staff provisioning and the M4 UI. It is rebuilt after those two land, not before.
- The persona audit reports, screenshots and QA scripts (`43f6410 bd5fae7 ea870bf c1d569b`) are still
  only on `m4/stock-signals`.

## Fix round 1 — verification, 2026-11-15

Builder run on `prompts/m4-fix-round.md`, commits `2051b8d..fb72f92` (eight, one per item). Checked
against the diff, not the notes.

**Verdict: not approved. Two migrations cannot run. One more fix round, small
(`prompts/m4-fix-round-2.md`).**

### Ran by the architect

`pnpm run typecheck` exit 0. `pnpm test:unit` 731 passed / 66 files. `pnpm run audit:invariants` all
20 checks ok. Integration and E2E not run: no M4 migration is applied anywhere.

Two SQL shapes were probed on the test project (`jcvsnoiacrknzejouxah`) with temporary objects inside
a transaction that was rolled back; nothing was created or changed.

### Blockers

**R1. `…231020` fails with 42P16.** `CASE WHEN pv.track_stock = false THEN NULL ELSE (…)::numeric(12,3) END`
has type `numeric` with no typmod; the existing column is `numeric(12,3)`. Probe result:
`cannot change data type of view column "available_quantity" from numeric(12,3) to numeric`.
Fix: cast the whole `CASE … END` to `numeric(12,3)`.

**R2. `get_low_stock_signals` and `get_reorder_suggestions` fail at first call with 42702.** Both
declare `variant_id` (and the first also `status`) as `RETURNS TABLE` columns and then use those
names unqualified in the reservations subquery (`SELECT variant_id, SUM(quantity) … WHERE status =
'active' … GROUP BY variant_id`). Probe result: `column reference "variant_id" is ambiguous`.
Fix: alias the table and qualify every column in those subqueries. `get_dead_stock_signals`
qualifies everything and is not affected.

### Majors

**R3. Three tests were deleted without being named; the notes say one.** The prompt allowed deleting
the digest test only. Also gone from `m4-stock-signals.integration.test.ts`: the
`decrement_order_stock` half of old test 2, old test 3 (staff get no `unit_cost` /
`capital_tied_up` / `total_dead_capital` from `/admin/inventory/signals/dead-stock`), and old test 5
(reorder evidence fields; staff get 403 on `/admin/inventory/signals/reorder`). No other test covers
the staff cost boundary on these routes. Restore all three.

**R4. A non-tracked item is removed from the cart at checkout.** `/products/prices` returns
`available: null` and `stock: Number(p.stock) || 0`; `CheckoutPage.tsx:59` falls back to `stock`
when `available` is not a number and removes the line when it is `<= 0`. `CheckoutPage.tsx` was not
in review D4's list — the list was a grep for `available_quantity` and said so; the miss is the
architect's. Assumed, not checked: that the legacy `products.stock` of a non-tracked product is 0.

**R5. Two new `as any`.** `p.stock = val as any` in `routes/products.ts` and `routes/categories.ts`
writes `null` into a field typed `number`. Not a client cast, so not covered by the one permitted
exception. Leave `stock` alone and carry the `null` only in `available_quantity`; then check what
the product card does with it.

### Minors

- Notes §3 names `20261104160000_m2b_posting_date_nullable.sql` as the source of five replaced
  objects. The migration headers name the right files and the diffs against those files show only
  the intended change (plus dropped comments), so the code is right and the table is wrong.
- `ReorderPage.tsx:113` still compares the group name with the literal `"Unassigned"`; after m3 that
  branch is dead.
- `…231100` (245 lines) and `…231500` (315) exceed 200 lines. The prompt put three functions in each;
  accepted, reason recorded here.

### Confirmed correct

Trigger (`…231000`): source body plus the ST030 block, no exception (D2). Guards (`…231010`): ST031–
ST034, reservation test is `status = 'active'` alone (D3). View grants match the latest prior state
(`20261105200000`): service_role only. `post_pending_counter_sale`, `decrement_order_stock`,
`void_counter_sale`, `post_counter_sale`: each diffed against its latest definition — only the
`track_stock` filter added; signatures, `SECURITY DEFINER` and grants kept; the payments insert is
in place. No `owner_notification_phone`, no digest table, function or route (D1). D6: `post_stocktake`
builds its deltas from `stocktake_lines` only, so the insert guard is sufficient. No `@ts-ignore`,
no `.skip(`. The eleven remaining client casts in the integration test are the permitted kind.

### Not checked

The frontend `NULL` handling was read in the diff, not exercised in a browser. The new integration
tests were read for names and setup assertions, not line by line. Whether the product card treats a
`null` stock as out of stock (R5). The three new invariant checks were run, not read.

## Fix round 2 — verification, 2026-11-15

Builder run on `prompts/m4-fix-round-2.md`, commits `5f65500..5317760` (five, one per item). Checked
against the diff, not the notes.

**Verdict: approved to apply to the test project.** Not yet approved to merge: no M4 migration has
run on Postgres as a migration, and the integration and E2E tiers have not run.

### Ran by the architect

`pnpm run typecheck` exit 0. `pnpm test:unit` 737 passed / 66 files. `pnpm run audit:invariants` all
checks ok.

The three RPC bodies were created as `pg_temp` functions on the test project
(`jcvsnoiacrknzejouxah`) inside a transaction that was rolled back, and each was called:
`get_low_stock_signals` returned 420 rows, `get_dead_stock_signals` 2, `get_reorder_suggestions`
216, no error. The corrected view expression was tried as `CREATE OR REPLACE` over a
`numeric(12,3)` temporary view: accepted. Nothing was created or changed in the project.

### Findings of round 1

| | Status |
|---|---|
| R1 view typmod | Fixed: the whole `CASE` is cast to `numeric(12,3)`; probed |
| R2 ambiguous references | Fixed: `res.` and `ss.` aliases in both functions; all three functions executed |
| R3 deleted tests | Restored: staff cost privacy on dead-stock, reorder evidence and staff 403, the `decrement_order_stock` half. The suite is split into `m4-stock-signals.integration.test.ts` (274 lines) and `m4-track-stock.integration.test.ts` (191); every round 1 test name is present in one of the two |
| R4 checkout removes an unlimited item | Fixed in `CheckoutPage.tsx`: `available === null` keeps the line and its quantity |
| R5 two `as any` | Removed. `stock` is left alone when availability is `null`; the `null` travels in `available_quantity` |
| Notes §3, §6; dead `"Unassigned"` comparison | Corrected |

No `@ts-ignore`, no `.skip(`, no new `as any` except the one client cast that moved with the split
test file.

### New minors, accepted for merge and recorded

- `CheckoutPage.tsx` applies a server price change by assigning `item.price` on the cart item it
  received from context and then calling `updateQty`. It works because the reducer copies the item;
  it is a mutation of state. The server prices the order, so this is display only.
- `resolveProductStock` (`lib/stock-decision.ts`) returns `outOfStock: true` when neither a stock
  nor an availability number is passed; the old inline code returned false. Every current caller of
  `ProductCard` passes `stock`, so nothing changes today.
- Both integration files exceed 190 lines and the first exceeds 200; split by concern as the prompt
  asked, reason recorded here.

### Not checked

The storefront was not exercised in a browser. The restored tests were compared by name and by the
presence of their assertions' subjects, not line by line against `f4b129d`. The other four
migrations were verified in round 1 by diff against their sources and have not been executed in any
form.

### Next, in order

1. Owner's consent, then apply the seven `20261113231xxx` migrations to the test project in one
   transaction, with verification queries.
2. Regenerate `database.types.ts`; remove the client casts it makes unnecessary.
3. Push the branch and run CI: integration and E2E.
4. The one cross-family adversarial audit, then the merge decision.

## Applied to the test project — 2026-11-15

With the owner's consent, the seven `20261113231xxx` migrations were applied to
`jcvsnoiacrknzejouxah` in one transaction (comments stripped; the file used is
`.agent-runs/apply-m4-stock-signals.sql`, not tracked). `supabase_migrations.schema_migrations` was
not written, as for the chore.

Verified afterwards by query:

- The source of all ten functions in the database has the same md5 as the body in the migration
  files (comment and blank lines removed on both sides).
- The seven `SECURITY DEFINER` functions are executable by `service_role` only. The three trigger
  functions are not definer functions.
- `product_variant_availability` has nine columns, `track_stock` last, `available_quantity` still
  `numeric(12,3)`; its only grantee among the API roles is `service_role`.
- Both guard triggers exist and are enabled. The four settings are present; `owner_notification_phone`
  is not.
- One variant in the project is non-tracked and the view returns `NULL` availability for it.

Not done: `database.types.ts` is not regenerated (no Supabase CLI session on this machine), so the
eleven client casts in the integration tests stay for now.

## CI — run 43682778875 on `fd00b40`+apply note, 2026-11-15: red

`unit` passed. `integration-e2e`: 8 failed, 1169 passed, 10 skipped (110 files, 3 failed). E2E 54
passed. The migrations are not the cause; nothing in the database needs to change.

**C1. Blocker — all four signal routes answer 500.** The Zod schemas added in round 1
(`routes/admin/inventory-signals.ts`) name fields the RPCs do not return (`reorder_point`,
`lead_time_days`, `daily_velocity`, `recommended_qty`, `preferred_supplier_name`) and declare
quantities as integers. `.parse()` throws on the first row. The admin pages read the RPCs' real
field names, so only the route is wrong. Fails tests 1 and 2 of `m4-stock-signals`.
The architect asked for Zod validation in round 1 and verified that schemas existed, not that they
matched the functions. Round 3 adds an offline test that compares the two.

**C2. The admin route inventory test expects 84 routes; the router registers 88.** The four signal
routes were never added to `tests/admin-routes.test.ts`. Two failures.

**C3. Test setup errors in `m4-track-stock`.** `stocktakes` insert without `stocktake_number`
(23502), twice; a filter on `reason = 'counter_sale_void'`, which is not an enum value (22P02).
Three failures.

**C4. Test data error in `m4-stock-signals` test 4.** The variant has ~250 days of cover, so the
RPC correctly omits it at a 60-day target and the test finds no row. One failure.

Also seen: the switch guard tests stocktake status `IN ('draft', 'in_progress')`; the table's
`CHECK` allows `draft`, `posted`, `cancelled`. `in_progress` can never match. Harmless, left as is;
the migration is applied.

Fix round: `prompts/m4-fix-round-3.md`.

## Fix round 3 — verification (2026-11-15)

Builder run `.agent-runs/m4-fix-round-3-20261115-200803.log`, exit 0. Commits `fdf2ee3` (C1),
`99ee93c` (C2), `535e0b9` (C3), `47b9d14` (C4 and notes). Accepted against the diff:

- Files changed are exactly the ones the prompt named, plus the new unit test and the notes.
- No `it(` removed; no new `as any`, `@ts-ignore` or `.skip(` in the diff.
- C1: each of the three schemas lists the `RETURNS TABLE` columns of
  `20261113231500_m4_stock_signals_rpcs.sql` by name and in order; no later migration redefines
  the three functions. Quantities `z.coerce.number()`, `sales_count` and `days_since_*` integers,
  nullables as specified, `status` enum matches the `CASE` ('out' / 'low'). `.parse()` replaced
  by `safeParse` with a fixed 500 message and logged issues; staff path still strips cost fields.
  The offline test reads both files and compares keys in order. Its fourth case compares two
  literal arrays and tests nothing — harmless, not worth a round.
- C2: the four routes are appended after `bundles`, matching `router.use(inventorySignals)` last
  in `routes/admin/index.ts:60`.
- C3: `stocktake_number` (UNIQUE NOT NULL) and `title` (NOT NULL) now supplied; `'draft'` is in the
  `CHECK`. The void filter `note = 'void'` matches what `void_counter_sale` writes
  (`20261113231100_m4_track_stock_sales_functions.sql`, reason `'counter_sale'`, note `'void'`).
- C4: `p_target_days: 100000`, both assertions kept, `sales_count` = 1 added.

Local tiers, run by the architect on `47b9d14`: `pnpm run typecheck` exit 0; `pnpm test:unit`
67 files, 741 tests passed; `pnpm run audit:invariants` "All invariant checks passed." The
integration tier was not run locally.

**CI run 43735808232 (round 3):** `unit` green; integration 1176 passed, 10 skipped, **1 failed**:
`m4-track-stock` test 2, `stocktake_lines` insert without `counter_id` (23502; `NOT NULL REFERENCES
users(id)`, `20261104130000_m2b_stocktake_tables.sql:89`). Fixed by the architect directly — test
setup only: `counter_id: actorId` on both `stocktake_lines` inserts (test 3 passed only because the
ST034 trigger fires before the NOT NULL check).

**CI run 43736281632:** the same test, next setup error: `reservations` insert without
`reservation_number` (23502). `agreed_price` is also NOT NULL with no default
(`20261104180000_m2c_reservations_schema.sql`); both supplied. Every other insert in test 2
checked against its table's NOT NULL columns.

**CI run 43736706062: green** — `unit` and `integration-e2e` (API integration, E2E) both
`success`, on `m4/stock-signals-core` after the reservation fix. Remaining before the merge
decision: regenerate `database.types.ts`, then the one cross-family adversarial audit.

## `database.types.ts` regeneration — blocked (2026-11-15)

Generated from the test project with the Supabase MCP `generate_typescript_types` and swapped in:
`pnpm run typecheck` fails with 17 errors, none caused by M4.

- **`product_specs`** (11 in `routes/products.ts`, 4 in `routes/categories.ts`): the table does not
  exist on the test project. The committed types came from another live project that has it; the only
  DDL in the repository is the runtime string in `routes/migration.ts:15`, not a tracked migration.
  So the related-products and category routes cannot work on a database built from this repository.
- **`orders.subtotal_azn`** (`routes/orders.ts:137`): `NOT NULL`, no default on the test project; the
  route never writes it. Adding it to the insert is only safe once production's `orders` shape is
  known — if production lacks the column, writing it breaks every order there. Same question as the
  delivery-fee design note's *Blocked* item.
- **`counter-lookup.ts:67`**: generated view columns are nullable, so `variant_id` is `string | null`
  as a `Map` key. A one-line fix; held back with the rest so the regen lands in one commit.
- `otp_codes` is in the committed types and not on the test project; no code reads it.

Not a merge blocker for M4: the code typechecks against the committed types and CI is green. The
regeneration waits for production's `information_schema.columns` for `orders` and `product_specs`.

## Adversarial audit — verification (2026-11-15)

Auditor run in a clean sub-agent (Claude, cross-family to the Gemini builder), prompt
`prompts/m4-audit.md` on branch `prompts/m4-audit` (`4c642bc`). Report:
`docs/audits/m4-stock-signals-audit.md` on `audit/m4-stock-signals-core` (`ffaf356`, pushed).
Verdict **FIX**: 4 major, 9 minor, no cost leak, no ledger corruption.

Majors, each checked against the code on `origin/m4/stock-signals-core` by the architect:

1. **Confirmed, introduced by M4.** `get_margin_report` takes revenue from `stock_movements` only
   (`20261111120800_margin_report_live_schema.sql:30-40`); non-tracked lines now write no movement, so
   their revenue leaves the report. Spec §9: a non-tracked line "reaches the receipt and the revenue
   figures".
2. **Confirmed.** Cancelling an order restocks through `increment_stock`, which writes
   `customer_return` (`20261102100000_m1_variants_ledger.sql:327-331`; called from
   `routes/admin/orders.ts:80-83`). The three RPCs count only `online_sale`/`counter_sale`
   (`20261113231500_m4_stock_signals_rpcs.sql:123,130,201`). A cancelled order stays in velocity and
   in "last sold". Spec §5.2's "self-correcting" assumed the reversal shares the sale's reason.
3. **Confirmed; root cause predates M4.** `InventoryPage.tsx` reads `product_variant_availability`
   with the browser client; `authenticated` lost `SELECT` in `20261105200000_m2c_view_security.sql:10`
   (and again in M4 `231020:36`), so the page falls back to `products.stock` (0 at creation,
   `routes/admin/products.ts:62`). M4's low-stock filter on that page inherits wrong numbers.
4. **Confirmed.** `ProductDetail.tsx:133-136` turns unlimited into `product.stock ?? 0` and passes it to
   `StickyAddToCartBar` (`:461-468`), which shows "out of stock" on `stock === 0` (`:85`). Mobile only.

Minors spot-checked: 6 (summary route hard-codes 90/28/60/3, `inventory-signals.ts:90,92`; the four
`store_settings` rows are never read) and 11 (cost-privacy assertions under `if (staffVar)`,
`m4-stock-signals.integration.test.ts:120-123`) confirmed. The rest not re-checked by the architect.

Next: fix round 4 with the four majors; minors 5, 6 and 11 if they fit; 7–10, 12, 13 recorded.

## Fix round 4 — verification (2026-11-15)

Builder run `.agent-runs/m4-fix-round-4-20261115-212606.log`, exit 0. Commits `6068df4` (1, margin),
`90fbe3a` (2, order returns), `3075eb1` (3, inventory availability), `6dd62a8` (4, sticky bar + notes).

- Files are the ones the prompt named; no existing migration edited; no test removed; no `.skip`,
  `@ts-ignore`.
- Both new functions diffed against their live definitions: only the requested change, same
  signature and grants.
- **Executed on Postgres before applying**, as `pg_temp` copies in a rolled-back transaction on the
  test project, beside the live functions over the same data:
  `get_margin_report` 400 days — 424 rows vs 420 live, revenue 6515.73 vs 6435.73: exactly the 4 posted
  non-tracked counter-sale lines (+80.00), every other row unchanged.
  `get_dead_stock_signals(90)` 6 = 6; `(1)` 244 vs 243; `get_reorder_suggestions(28, 100000, 3)` 427 vs
  428 — one variant whose sales are fully netted by order returns leaves reorder and enters dead stock.
  84 `customer_return`/`order` movements exist; old ones have NULL `reference_id` and are not netted
  (they age out of the window).
- `as any`: one new in `inventory-signals.ts` on a typed view — removed by the architect. Four new
  in the two integration tests, on RPCs absent from `database.types.ts` (same pattern as the existing
  cases in those files); they go when the blocked type regeneration lands.
- Noted, not fixed: `InventoryPage.tsx` still falls back silently to `products.stock` if the new
  endpoint fails.

Local tiers on the branch with the cast removed: `pnpm run typecheck` exit 0; `pnpm test:unit`
67 files, 741 passed; `pnpm run audit:invariants` "All invariant checks passed." Integration not run
locally. The two migrations are **not yet applied** to the test project.

**Applied 2026-11-15, owner's approval in chat:** `20261116100000_m4_margin_report_non_tracked.sql`
and `20261116100100_m4_signals_net_order_returns.sql` to the test project, each as one transaction
through the Supabase MCP `execute_sql` (bodies byte-identical to the dry run). Stored `md5(prosrc)`
equals the files: `get_margin_report` 8b5a5d8b… (file body with its one comment line stripped, as
applied), `get_dead_stock_signals` 74676a84…, `get_reorder_suggestions` 6ac2334e…. `EXECUTE`:
`service_role` only; `anon` and `authenticated` false. `supabase_migrations.schema_migrations` not
written, as for the earlier M4 migrations.
