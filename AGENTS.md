# AGENTS.md

House rules for every agent session in this repository. Always in context — keep it short.
Detailed rules live in `.agents/rules/` and load on trigger. Specs live in `docs/tasks/`.

## Stack
pnpm workspaces · Node 24 · TypeScript 5.9 · Express 5 API · React + wouter storefront/admin ·
Supabase/Postgres with RLS · Zod validation · Orval codegen from OpenAPI · Vitest · Playwright E2E.

Layout: `artifacts/store` (UI), `artifacts/api-server` (API), `lib/*` (shared, generated),
`supabase/migrations` (schema), `supabase/control-plane` (multi-tenant control plane).

## Commands
- `pnpm run typecheck` — full typecheck, must pass before any commit
- `pnpm test` — vitest
- `pnpm run audit:invariants` — architectural invariant checks, must pass before any commit
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks/schemas after spec changes
- `pnpm --filter @workspace/api-server run dev` — API on port 5000

## How work is organised
1. Read the spec named in your launch prompt from `docs/tasks/`. Do not ask for it to be pasted.
2. Write a design note to `docs/design-notes/<phase>.md`, commit it, and **stop**. Wait for review.
3. Only after approval, implement in small commits on the phase branch.
4. Make `typecheck`, `test` and `audit:invariants` pass before declaring done.

You are expected to propose better approaches than the spec where you see them. Say so in the
design note and explain the trade-off — do not silently deviate during implementation.

## Deny
- Never commit to `main`. Work only on the phase branch you were given.
- Never edit anything under `docs/tasks/` — specs are written by the architect, not the implementer.
- Never run migrations against a production Supabase project. Local or branch database only.
- Never touch `.env`, secrets, or credentials; never commit them.
- Never change `minimumReleaseAge` in `pnpm-workspace.yaml` — it is a supply-chain guard.
- Never delete or `.skip()` an existing test. If a test breaks, fix the cause or report it.
- Never disable a lint rule or add `@ts-ignore` / `as any` to make a build pass. Fix the type.
- No new file over 200 lines without saying in the design note why it must be that long.

## Conventions
- Migrations: one concern per file, follow the existing timestamped naming in `supabase/migrations/`.
- Every new table: RLS enabled plus explicit policies. Tenant-scoped like the tables around it.
- No column, table, enum value or identifier named after one customer's industry.
- Prefer the simple query. This product serves shops with hundreds of SKUs and tens of sales a day;
  do not add caching, denormalisation or background jobs for volume that does not exist.
- Commit messages: `<type>(<scope>): <what changed>`. Small, reviewable commits.

## Audit interface
Your work is reviewed from git, not from chat. Anything that matters must end up in a file:
design notes, code, tests, and migration files. A decision explained only in the chat is lost.
