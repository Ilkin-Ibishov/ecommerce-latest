---
name: audit-invariants
description: >-
  Use this skill before committing code or completing an implementation to verify architectural
  invariants, stock movement integrity, database conventions, and tenant boundaries.
---

# Invariant Audit Workflow

This repository enforces strict architectural and domain invariants via `scripts/audit/check-invariants.mjs`. Violations will fail CI and block merges.

## When to Run

- Before any git commit.
- After adding or modifying migrations, schemas, inventory logic, or tenant-scoped queries.
- Before declaring any task, feature, or bugfix complete.

## How to Execute

Run the audit check from the repository root:

```bash
pnpm run audit:invariants
```

## Key Invariants Guarded

1. **Inventory & Movement Ledger**:
   - Stock exists strictly on variants (`product_variants`), never directly on `products`.
   - On-hand stock modifications must write an immutable row to `stock_movements`.
   - Never write a reservation into `stock_movements`.
   - Quantity columns must be numeric with scale (not integer).
2. **Row-Level Security (RLS)**:
   - Every table in Supabase migrations must have RLS enabled (`alter table ... enable row level security`).
   - Explicit tenant-isolation policies must be declared.
3. **Naming & Domain Purity**:
   - No table, column, enum value, or identifier named after a single customer or specific industry.
4. **Code Quality**:
   - No new files over 200 lines without explicit architectural justification.
   - No `@ts-ignore` or `as any` escape hatches.

## Interpreting Failures

If `pnpm run audit:invariants` fails:
1. Read the reported invariant error message and the file/line indicated.
2. Fix the underlying root cause in code or migration — do not weaken the invariant script.
3. Re-run `pnpm run audit:invariants` until it reports `0 failures`.
