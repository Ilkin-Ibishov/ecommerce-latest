# M2a — design note only. Write no migrations and no application code.

Read, in this order:

1. `AGENTS.md` — house rules
2. `docs/STATUS.md` — what M1 delivered and which decisions are already closed
3. `docs/tasks/warehouse-m2a-receiving-cost.md` — the work order for this phase
4. `.agents/rules/inventory.md` — domain invariants
5. `docs/design-notes/m1-variants-ledger.md` — the shape a design note takes here, and the schema
   you are extending
6. `supabase/schema.sql` — the live schema, in particular `stock_movements`, its immutability and
   on-hand triggers, `product_variants`, and `variant_costs`

Then write `docs/design-notes/m2a-receiving-cost.md` and commit it. **Stop there.**

## What the note must contain

- A direct answer to every open question in §11 of the work order. Numbered the same way.
- Your resolution of §5 — the collision between an immutable ledger and replay-based costing —
  argued, not asserted. Say which option you chose, what you rejected, and why. State explicitly
  what is the source of truth for cost of goods sold and what is a rebuildable cache.
- The proposed schema: tables, columns with types, keys, constraints, RLS posture for each. Say for
  every new table whether cost data can reach a staff token through it.
- How a receipt posts atomically, and where that atomicity is enforced.
- The replay algorithm in enough detail to be reviewed: ordering, scope of recompute, what happens
  to opening balances with no cost, what happens to returns.
- A migration plan that keeps `main` deployable at every commit, with a rollback note.
- Anything in the work order you believe is wrong. Say it now. A decision you disagree with is far
  cheaper to argue before the migration than after.

## What the note must not contain

- Padding. No restating the work order back at me, no feature inventory, no implementation
  timeline, no section that merely agrees with the spec.
- Scope beyond M2a. Stocktake and reservations are a separate branch; if your schema needs to leave
  room for them, say which column or key does that and move on.

Length is whatever the argument needs — M1's note was roughly 300 lines and that was not too long.
A note that reads as agreement is a note that found nothing, and that has not yet been true on this
project.

## When you are done

Commit with a conventional-commit message and stop. Do not begin migrations. The note is reviewed
before any schema changes, and three blockers were caught at exactly this gate in M1 — including
cost being world-readable.
