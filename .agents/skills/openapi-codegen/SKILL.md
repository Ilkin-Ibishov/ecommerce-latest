---
name: openapi-codegen
description: >-
  Use this skill whenever modifying OpenAPI specifications, updating backend endpoint contracts,
  or regenerating frontend API hooks and Zod schemas with Orval.
---

# OpenAPI Codegen Workflow

This project uses OpenAPI as the single source of truth for the API contract between `artifacts/api-server` and `artifacts/store`. Code generation is handled via Orval.

## When to Run

1. You added, modified, or deleted an API route in `artifacts/api-server`.
2. You modified an OpenAPI spec in `lib/api-spec/` or schema definitions.
3. You need regenerated TypeScript types or Zod validation schemas for API requests/responses.

## How to Execute

Run the codegen command from the repository root:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Generated Outputs

The codegen command updates files in:
- `lib/api-client-react/` — React Query hooks and fetchers used by `artifacts/store`
- `lib/api-zod/` — Zod schemas used by `artifacts/api-server` for request validation

## Verification Steps

After running codegen, always verify type safety and invariants:

1. **Check generated diff**:
   ```bash
   git status --short lib/
   ```
2. **Run TypeScript check**:
   ```bash
   pnpm run typecheck
   ```
3. If there are type errors in either `artifacts/store` or `artifacts/api-server`, adjust the route handlers or components to match the updated contract.
