# M1 — implement

The revised design note is **approved**. All three blockers and the minors are resolved, and
resolved well:

- **B1** — moving cost into `variant_costs` under admin-only RLS is the right call, and your reason
  for it is sharper than the review's: RLS controls row visibility, not column projection. A public
  read policy on a table containing a cost column publishes that cost, full stop. It also gives M2's
  costing model a natural home.
- **B2** — raising a catchable error from inside the trigger and mapping it in the RPC wrapper
  preserves Invariant 7 and keeps the existing tests meaningful.
- **B3** — the `pg_trigger_depth()` guard makes the single-write-path a property of the database
  rather than a convention. This is the sentence the whole phase rests on.
- **M1** — correcting the `FOR UPDATE` claim, and explaining why a bare
  `UPDATE ... SET x = x + delta` is already race-free under `READ COMMITTED`, is exactly what was
  needed. The wrong claim was the danger, not the missing lock.

Proceed to implementation on this branch, following the Phase A / B / C plan in §2 Q2 of your note.

---

## One refinement before you start

**Do not use `P0001` for the insufficient-stock error.**

`P0001` is PL/pgSQL's generic `raise_exception` — it is what *every* bare `RAISE EXCEPTION` without
an explicit `ERRCODE` produces. Inside this schema you have given the other errors distinct codes,
so it is unambiguous today. It will not stay that way: the first future function that raises a bare
exception anywhere in the database will be reported to a user as "Insufficient stock".

Pick a distinct code in a class PostgreSQL does not define, document it next to the trigger, and
have the RPC wrapper match on that. Apply the same reasoning to `P0002` ("Variant not found"). The
codes you already chose for the other cases (`55000`, `42501`, `2BP01`) are fine — it is only the
`P000x` pair that is too generic.

---

## How to work

Commit per logical step, not per phase — a reviewer should be able to read one migration, or one
route's conversion, on its own. Phase A should land before any route is touched, so that `main`
stays deployable at every commit as your note promises.

Take the migration call-site list in §5 of `docs/tasks/warehouse-m1-variants-ledger.md` as a
starting point, not a complete one. There are roughly 311 `product_id` references across 46 files;
discovery is part of the task.

## Definition of done

From the work order §8, unchanged:

- `pnpm run typecheck` green
- `pnpm run test:unit` green
- `pnpm run audit:invariants:strict` green — **the baseline is empty**, meaning all six known
  direct-stock-write violations are gone, not merely unchanged
- `main` deployable at every commit on this branch
- Every deliverable in §7 of the work order exists, or your notes say why it should not

The tests your own §5 commits you to — single-write-path (direct `on_hand` update rejected),
insufficient stock under concurrency, ledger sum equals `on_hand`, and the cost/role RLS tests
asserting non-admin callers get zero rows from `variant_costs` — are part of done, not a follow-up.

## What you cannot verify locally, and must not claim

`api-integration` needs Supabase credentials and a running API server; it runs in CI only. Several
of the tests above live in that tier. Write them, run what you can, and state plainly which tiers
you actually executed and which you did not. A claim that integration tests passed locally is a
claim I will check.

## Notes

Write `docs/audits/m1-implementation-notes.md`: what changed per phase, anything you found that
contradicts the design note, what you chose not to do, and the real output of the three commands
above.
