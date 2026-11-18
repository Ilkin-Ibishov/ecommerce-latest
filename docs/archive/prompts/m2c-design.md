# M2c — design note only. Write no migrations and no application code.

Read, in this order:

1. `AGENTS.md` — house rules
2. `docs/STATUS.md` — what M1, M2a and M2b delivered and which decisions are closed
3. `docs/tasks/warehouse-m2c-reservations.md` — the work order for this phase
4. `.agents/rules/inventory.md` — domain invariants, including the reservations rule
5. `docs/audits/m2b-stocktake-audit.md` and `docs/audits/m2b-fix-3-notes.md` — the six defects M2b
   shipped and why. Five were faithful implementations of rules that were precise but incomplete.
   Read them for the failure mode, not the details
6. `supabase/schema.sql` — the live schema: `stock_movements` and its before-insert apply trigger,
   `product_variants.on_hand`, and the stocktake tables
7. The storefront and cart paths that read a quantity today — catalogue, product page, cart,
   checkout. You need to know how many places §8 of the work order touches before you propose
   anything

Then write `docs/design-notes/m2c-reservations.md` and commit it. **Stop there.**

## What the note must contain

- A direct answer to every open question in §10 of the work order, numbered the same way.
- For every non-trivial rule, the two statements §11 demands: how it behaves in the **ordinary**
  flow, and which **earlier decision** it intersects. This is not a formality — it is the specific
  check that would have caught five of M2b's six defects, and a note that skips it will be sent back.
- The proposed schema: tables, columns with types, keys, constraints, RLS posture for each.
- Your answer to §4, the central problem: where availability is enforced in the sale path, what it
  locks, and why two concurrent orders cannot both take the last available unit. Argue it; do not
  assert it.
- The full list of storefront and admin call sites that must change, with the ones you are confident
  about separated from the ones you are not.
- A migration plan that keeps `main` deployable at every commit, with a rollback note.
- Anything in the work order you believe is wrong. Say it now. Your disagreements in M2a and M2b were
  mostly correct and changed the design; that has been worth more than agreement.

## What the note must not contain

- Padding. No restating the work order, no feature inventory, no timeline, no section that merely
  agrees with the spec.
- Scope beyond M2c. Cart reservations and the counter sale are later phases; name the column or key
  that leaves room for them and move on.
- A proof dressed as mathematics where prose would do. Use that register only for the concurrency
  argument in §4, where it earns its place.

Length is whatever the argument needs.

## When you are done

Commit with a conventional-commit message and stop. Do not begin migrations. Three blockers were
caught at this gate in M1 and one architectural collision in M2a; the gate is the cheapest place in
this workflow to be wrong.
