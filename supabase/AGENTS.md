# Database Agent Guidelines

This directory (`supabase`) holds the schema: migrations, the control plane, and `schema.sql`.
Loaded by scope, so these rules apply to any SQL work here. Never run a migration against a
production project — local or branch database only.

## Non-negotiable
- One concern per migration file. Do not bundle a table creation with an unrelated backfill.
- Follow the existing timestamped filename convention in `supabase/migrations/`.
- Every new table: `alter table ... enable row level security` plus explicit policies.
  Copy the tenant-scoping shape used by the tables around it — never weaker.
- Migrations must be forward-only. Never edit a migration that is already committed to `main`;
  write a new one.
- A migration must apply cleanly to an empty database **and** to a database holding existing rows.
  Say in the design note which you tested.

## Append-only tables
Some tables in this schema are append-only ledgers. For those:
- No `UPDATE` or `DELETE` path may exist, in SQL or in application code. Enforce it in the database.
- Corrections are new compensating rows, never edits.
- A cached aggregate (such as a current quantity) must be written in the **same transaction** as the
  row it summarises, so the two cannot diverge. Prefer a database-level guarantee over an
  application-level convention.

## Backfills
- State explicitly what happens to a tenant that has existing data and to one that has none.
  Both cases must be correct; they are usually different.
- An opening-balance row needs a defensible timestamp, actor and cost basis. Say what you chose.

## Before you finish
- Apply the migration locally and confirm the app still boots.
- If the schema changed in a way the OpenAPI spec describes, regenerate:
  `pnpm --filter @workspace/api-spec run codegen`.
- Run `pnpm run audit:invariants`.

## Two Postgres rules that reading the SQL does not reveal

Both produced migrations that looked correct and could not run (M4, 2026-11-15).

- **`CREATE OR REPLACE VIEW` must keep each existing column's exact type, including its typmod.**
  `CASE WHEN c THEN NULL ELSE x::numeric(12,3) END` is plain `numeric`; the replace fails with
  42P16. Cast the whole expression: `(CASE … END)::numeric(12,3)`. New columns go last.
- **In a plpgsql function with `RETURNS TABLE`, every output column name is a variable.** A bare
  `variant_id` or `status` inside the body is ambiguous (42702) at the first call, not at creation.
  Alias every table in every subquery and CTE and qualify every column.

When you replace a function, start from its **latest** definition, change only what the task names,
and keep its signature, `SECURITY DEFINER` setting and grants. Name the source file in your notes.
