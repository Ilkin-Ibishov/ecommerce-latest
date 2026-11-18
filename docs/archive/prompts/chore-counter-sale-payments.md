# Chore — counter_sale_payments, design note first

Read `AGENTS.md`, then the spec `docs/tasks/chore-counter-sale-payments.md`, then
`docs/tasks/warehouse-m3-section-16-decisions.md` §16.4, `.agents/rules/migrations.md` and
`.agents/rules/inventory.md`. Do not edit the spec.

Work on branch `chore/counter-sale-payments`, created from `main` after the spec branch is merged. Never
commit to `main`. Never run a migration against anything but the test project.

## Step 1 — design note only, then stop

Write `docs/design-notes/chore-counter-sale-payments.md`, commit it, and **stop**. No migration, no route,
no test before it is reviewed. The note must:

- answer every item in spec §8, each with the ordinary-flow behaviour and the earlier decision it meets;
- say how the rows are made immutable (trigger or grant) and why;
- say whether you recommend dropping `counter_sales.payment_method` now (spec §4) and the trade-off;
- state what the day-end count misses until deposit pick-ups record a method (spec §5a);
- list every file you will touch, and flag any over 200 lines.

If you see a better approach than the spec, say so in the note. Do not deviate silently.

## Step 2 — only after approval

Implement in small commits, one per concern: lookup table, payments table and constraints, backfill,
`post_counter_sale`, tests, invariant. Commit format `<type>(<scope>): <what changed>`.

Do not skip or delete any test. No `@ts-ignore` or `as any`. Regenerate
`artifacts/supabase-types/src/database.types.ts` only by the repo's own method; if you cannot, say so.

## Done means

`pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants` pass. In your notes say which
tiers you ran. The `api-integration` tier needs credentials and a running server and runs in CI; do not
claim it passed locally.
