# Audit — chore `counter_sale_payments`

2026-11-14, architect pass. Branch `chore/counter-sale-payments` at `c5e8d74`, against
`docs/tasks/chore-counter-sale-payments.md`. Inputs: the spec, `git diff main...HEAD`, the invariant
list, and read-only queries on the test project (`jcvsnoiacrknzejouxah`). The design note was not used
as evidence.

**Verdict: needs rework. Not mergeable.** Three blockers, three major, four minor. The core of the
function change is right; what fails is everything around it.

## Process

- The design-note gate did not hold. The note was committed 21:59, the first migration 22:00. Nobody
  reviewed it.
- No implementation notes file exists, so nothing states which tiers ran. The launch prompt required it.
- **None of the four migrations has ever executed.** On the test project `payment_methods` and
  `counter_sale_payments` do not exist and `post_counter_sale` is still the M3 version. The integration
  test file has therefore never run. This project has already paid for SQL that was never run (the
  `verify_stock_integrity` syntax error).
- `database.types.ts` was not regenerated and the branch does not say so.

## Blockers

### B1. The integration test "a voided sale keeps its payment rows" cannot pass

It posts with `payment_method = "bank_transfer"`. `counter_sales.payment_method` still carries
`CHECK (payment_method = ANY ('cash','card','other'))` (confirmed live), so the header insert is
refused with 23514. The test ignores the error from `post`, the void then finds no sale, and
`expect(voided.error).toBeNull()` fails. CI goes red on the first run.

Fix: use `other`. Do not widen the CHECK — a new method in the till is out of scope (§9). Also assert
`error` on every `post` in the file; three of five tests discard it.

### B2. Applying the migrations one at a time takes the till down

`20261113230200` creates `trg_counter_sales_has_payments`, which refuses any new `counter_sales` row
without payments at commit. The function that writes the payment arrives in `20261113230400`. Between
the two, every counter sale fails with ST027. Migrations here are applied by hand, in pieces
(STATUS item 5, rounds 7 and 10), so the gap is not theoretical.

Fix: create that trigger in `20261113230400`, after the `CREATE OR REPLACE FUNCTION`. The table,
immutability trigger and the sum trigger on `counter_sale_payments` can stay where they are.

### B3. This branch and `m4/stock-signals` each replace `post_counter_sale`, and each drops the other's change

| Migration | Branch | Has payment insert | Has `track_stock` |
|---|---|---|---|
| `20261113220010_m4_track_stock_sales_functions.sql` | `m4/stock-signals` | no | yes |
| `20261113230400_post_counter_sale_payments.sql` | this one | yes | no |

Fresh database, both merged: the chore's file sorts last, so the `track_stock` fix (STATUS item 15)
is silently undone and a service variant is decremented again. One untracked variant already exists on
the test project. Applied by hand in the other order: M4's version wins, writes no payment row, and
every sale is refused with ST027.

Resolution, architect's call: **the chore merges first, as the spec ordered.** M4 rebases onto it, and
its function migration is re-timestamped after `20261113230400` and carries both changes. That is a
finding against M4, recorded here because this is where it was found. It also becomes an invariant —
see M2.

## Major

### M1. Three of the seven tests in spec §6 are missing

Absent: a two-leg split that sums commits; one that does not sum is refused at commit; the backfill
gives one row per existing sale. The deferred sum trigger — the one piece of new logic with a branch —
has no test at all. All three are reachable through PostgREST without a multi-statement transaction:

- refused: insert a second leg with `amount > 0` on a posted sale → ST027;
- commits: insert a second leg with `amount = 0` and a different method → two rows, sum unchanged;
- backfill: no `counter_sales` row without a payment row, and no sale whose payments differ from its
  total (two count queries, both zero).

### M2. The new invariant is bypassed by four ordinary statements

Each of these exits 0 with "0 total" (run against fixtures, 2026-11-14):

```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT ON public.counter_sales, public.counter_sale_payments TO authenticated;
CREATE POLICY client_insert ON public.counter_sale_payments FOR INSERT TO authenticated WITH CHECK (true);
GRANT INSERT ON "public"."counter_sale_payments" TO authenticated;
```

The grant pattern requires the table to be the only, unquoted object; the policy pattern requires a
double-quoted policy name. Fix both and add these four as failing fixtures.

Add a second check for B3: the last migration, in file order, that defines `post_counter_sale` must
contain `INSERT INTO public.counter_sale_payments`. That is the mechanical form of "a later
`CREATE OR REPLACE` must not drop the payment row", and it would have caught the M4 collision.

### M3. The backfill is not re-runnable once a split sale exists

`ON CONFLICT (sale_id, method) DO NOTHING` skips only a row with the same method. For a sale later
settled cash + card with `payment_method = 'other'`, a re-run inserts a third leg for the full total,
the deferred check fails, and the whole migration rolls back. Ordinary flow today: harmless, there are
no splits. It meets §1's stated purpose, which is exactly to allow them.

Fix: `WHERE NOT EXISTS (SELECT 1 FROM counter_sale_payments p WHERE p.sale_id = cs.id)`.

## Minor

- **m1.** `"PaymentMethods: staff/admin read"` is `TO authenticated USING (true)`. In this product
  `authenticated` is every signed-in shopper. The data is three labels, so nothing leaks, but the name
  states a restriction the policy does not make. Rename it to what it does, or restrict it.
- **m2.** `counter_sales.total_amount` can be updated without the sum being rechecked — the constraint
  trigger on `counter_sales` fires on INSERT only. No code path does it today. Make it
  `AFTER INSERT OR UPDATE OF total_amount`; that is §5's "never modify prices afterwards" as a rule
  rather than a habit.
- **m3.** `counter-sale-payments.test.ts` lives in `artifacts/store`, and half of it asserts that
  migration files contain particular strings. Those tests pin wording, not behaviour, and break on a
  reformat. Keep the invariant-fixture half, beside the other invariant tests; delete the string half
  once M1's tests exist.
- **m4.** `idx_counter_sale_payments_method` serves no query in this chore. Drop it; add it with the
  day-end report if that report needs it.

## What holds

Read against the M3 function line by line; the only functional change is the one insert.

- Replay, both paths: the early `FOUND` return and the `ON CONFLICT` race return both exit before the
  payment insert. No second row.
- `needs_owner`: the payment is written before the savepoint block, so an ST001 rollback keeps it. Any
  other error rolls back header and payment together.
- `post_pending_counter_sale` and `void_counter_sale` are untouched and write no payment row. A voided
  sale keeps its legs.
- Immutability by trigger, all roles, same as `stock_movements`. Right choice: a grant does not bind
  `service_role`.
- RLS on, admin-only SELECT, no client write grant, no write policy. A zero-amount row is legal.
- §5a (pick-ups) correctly left out.

## Tiers run for this audit

Run locally at `c5e8d74`: `pnpm run typecheck` — exit 0. `pnpm test:unit` — 694 tests, 62 files, all
pass. `pnpm run audit:invariants` — pass, 15 checks. Integration tier: not run, and cannot pass until
the migrations are applied to the test project and B1 is fixed.

## Next

One fix round by the builder: `prompts/chore-counter-sale-payments-fix.md`. Then a human applies the
four migrations to the test project (the harness declines `CREATE TRIGGER`), CI runs, and only then
does this merge.
