# Phase M4 — Stock Signals, design note first

Read `AGENTS.md`, then the spec `docs/tasks/warehouse-m4-stock-signals.md`, `.agents/rules/inventory.md`,
`.agents/rules/migrations.md`, and `.agents/rules/frontend.md`. Do not edit the spec.

Work on branch `m4/stock-signals`, created from `main`. Never commit to `main`. Never run migrations
against anything but the test project.

## Step 1 — design note only, then stop

Write `docs/design-notes/m4-stock-signals.md`, commit it, and **stop**. No migration, no route, no UI
component before the design note is reviewed and approved.

The note must:
- answer every open question in spec §13, each with concrete codebase evidence;
- answer every intersection in spec §12, stating ordinary-flow behaviour and earlier decisions it meets;
- detail the fix for `track_stock` (§9) in the movement ledger apply trigger and counter sale;
- detail the fix for `low_stock` in `notifications.ts`;
- define the signals calculation boundary (database RPC vs application query) and guarantee that cost
  and capital metrics remain strictly owner-only (M2a cost RLS);
- list every file to be created or modified, and justify any file exceeding 200 lines.

If you propose an alternative approach to any part of the spec, explain the trade-offs clearly in the note.
Do not deviate silently during implementation.

## Step 2 — only after approval

Implement in small, reviewable commits on the phase branch.
Commit format: `<type>(<scope>): <what changed>`.

## Done means

`pnpm run typecheck`, `pnpm test:unit` and `pnpm run audit:invariants` pass. Report which tiers were run.
