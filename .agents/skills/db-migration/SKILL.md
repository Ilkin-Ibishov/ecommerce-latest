---
name: db-migration
description: >-
  Use this skill when creating, reviewing, or testing Supabase PostgreSQL migrations,
  defining RLS policies, altering schemas, or working with ledger tables.
---

# Database Migration Workflow

All schema changes in this repository are managed through version-controlled, timestamped SQL migration files located in `supabase/migrations/`.

## Authoring Standards

1. **One Concern per File**: Do not bundle new table creations with unrelated data backfills or schema edits.
2. **Naming Convention**: Timestamped format matching existing migrations:
   `YYYYMMDDHHMMSS_<descriptive_name>.sql`
3. **Forward-Only**: Never edit a migration that has already been committed to `main`. Always create a new forward migration.
4. **Mandatory RLS**:
   Every new table MUST include:
   ```sql
   alter table <table_name> enable row level security;
   ```
   Followed by explicit tenant isolation policies matching neighboring tables.
5. **Append-Only Ledgers**:
   For ledger tables (e.g., `stock_movements`):
   - Never provide `UPDATE` or `DELETE` grants or triggers.
   - Corrections must be compensating append-only rows.

## Post-Migration Steps

1. If schema changes impact the API contract, regenerate client types and schemas:
   ```bash
   pnpm --filter @workspace/api-spec run codegen
   ```
2. Verify invariants:
   ```bash
   pnpm run audit:invariants
   ```
3. Run typecheck:
   ```bash
   pnpm run typecheck
   ```
