# Launch prompt — M1 audit

Act as the `auditor` agent defined in `.agents/agents/auditor.md`. Read that file first and follow
it exactly, including the rule that you fix nothing.

## Your inputs

- Spec: `docs/tasks/warehouse-m1-variants-ledger.md`
- Invariants: `.agents/rules/inventory.md`
- Branch under review: `m1/variants-ledger`
- Diff: `git diff main...m1/variants-ledger`
- Mechanical checks: `pnpm run typecheck`, `pnpm test`, `pnpm run audit:invariants:strict`

**Do not read `docs/design-notes/m1-variants-ledger.md`.** It contains the implementer's reasoning.
This review exists to catch what that reasoning missed, and you cannot do that from inside it.

## What to hunt for in this particular phase

These are the failure modes this design is most exposed to. Finding one of them is worth more than
twenty style observations.

1. **A quantity path with no movement row.** Find every route, RPC, trigger and admin action that
   can change a quantity, and for each one point at the line that writes the ledger entry. One that
   does not have one is the defect this whole phase exists to prevent.
2. **Divergence under failure.** What happens if the process dies between the quantity write and
   the ledger write? If they are not in one transaction — or one database-level operation — construct
   the sequence that leaves them disagreeing.
3. **Concurrency.** Two simultaneous decrements of the last unit. A sale and an admin adjustment at
   the same instant. Does the atomic guarantee of the original `decrement_stock_safe` survive the
   refactor, or did it quietly become read-modify-write?
4. **Reservations written as movements.** They must not be. Check nothing in the new schema or code
   treats a promise-to-a-customer as a change in what is physically present.
5. **RLS gaps.** For every new table, does a user of tenant A reach tenant B's rows? Check the
   policies, not the comments claiming they exist.
6. **Role leakage.** Can a staff-role user read cost or margin through any endpoint, including a
   generic list endpoint or a generated client hook that returns more fields than the screen shows?
7. **Migration correctness on both paths.** Applied to a database with existing rows, and to an
   empty one. Does either leave a tenant with wrong opening quantities?
8. **Silenced tests.** Diff the test files specifically. Was anything deleted, skipped, or had an
   assertion loosened to make the suite pass?

## Output

Write `docs/audits/m1-variants-ledger-audit.md` in the format given in `.agents/agents/auditor.md`,
commit only that file, and stop. Every finding needs a concrete failing scenario — specific inputs
or sequence of events and the wrong outcome they produce. A finding without one is an opinion, and
I will discard it.

If the implementation holds up, say so and list what you checked. I would rather have an honest
short report than a padded one.
