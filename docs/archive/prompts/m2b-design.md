# M2b — design note only. Write no migrations and no application code.

Read, in this order:

1. `AGENTS.md` — house rules
2. `docs/STATUS.md` — what M1 and M2a delivered and which decisions are closed
3. `docs/tasks/warehouse-m2b-stocktake.md` — the work order for this phase
4. `.agents/rules/inventory.md` — domain invariants
5. `docs/design-notes/m2a-receiving-cost.md` — the costing engine you will value corrections with,
   in particular the replay algorithm, its scoping by `posting_date`, and the
   `variant_costs.opening_cost` carrier
6. `docs/audits/m2a-receiving-cost-audit.md` and `docs/audits/m2a-fix-notes.md` — the defect classes
   this project actually produces, worth knowing before you repeat one
7. `supabase/schema.sql` — the live schema: `stock_movements` and its before-insert apply trigger,
   the immutability trigger, `product_variants`, `variant_costs`, `stock_movement_costs`

Then write `docs/design-notes/m2b-stocktake.md` and commit it. **Stop there.**

## What the note must contain

- A direct answer to every open question in §10 of the work order, numbered the same way.
- The proposed schema: tables, columns with types, keys, constraints, and the RLS posture of each.
  For every new table say whether an expected quantity or a cost can reach a staff token through it —
  blind counting is a security property here, not a UI preference.
- The exact mechanism by which the system's on-hand snapshot is captured per line, and your argument
  that a client cannot supply or tamper with it.
- How posting converts lines into movements atomically, where that atomicity lives, and what a
  500-line post does.
- How the opening-count mode differs from an ordinary count, and why the reason code matters to
  M2a's average.
- How three people counting at once is resolved, including the duplicate-variant case.
- A migration plan that keeps `main` deployable at every commit, with a rollback note, written for
  SQL that has never been executed against a real database.
- Anything in the work order you believe is wrong. Say it now. Two of your three disagreements in
  M2a were correct and changed the design; that was worth more than agreement.

## What the note must not contain

- Padding. No restating the work order back at me, no feature inventory, no timeline, no section
  that merely agrees with the spec.
- Scope beyond M2b. Reservations and deposits are M2c; if your schema should leave room for them,
  name the column or key that does and move on.
- A proof dressed up as mathematics where prose would do. The M2a note's induction earned its place
  because partial replay was genuinely subtle. Use that register only where the argument needs it.

Length is whatever the argument needs.

## When you are done

Commit with a conventional-commit message and stop. Do not begin migrations. The design note is
reviewed before any schema change — three blockers were caught at this gate in M1 and one
architectural collision in M2a.
