---
inclusion: fileMatch
fileMatchPattern: "**/api-spec/**,**/api-zod/**,**/api-client-react/**,**/openapi*"
---

# OpenAPI Spec & Codegen

`lib/api-spec/openapi.yaml` is the single source of truth for all API contracts.

## Codegen Command

```bash
pnpm --filter @workspace/api-spec run codegen
```

This produces:
- Zod validation schemas in `@workspace/api-zod` → `lib/api-zod/src/generated/api.ts`
- React Query hooks in `@workspace/api-client-react` → `lib/api-client-react/src/generated/api.ts`

Re-run codegen after every spec change. Do not hand-write types that codegen produces.

## Writing the Spec

- Base server URL is `/api`. Do not change this.
- Keep the existing `/healthz` endpoint and `HealthStatus` schema.
- Every endpoint must have an `operationId` — Orval uses these to derive hook/schema names.
- Put every request/update body in `components/schemas` and `$ref` it.
- Use entity-shaped names (`NoteInput`, `NoteUpdate`) — NEVER operation-shaped names (`CreateNoteBody`).
- Never inline request bodies — always `$ref` to a component schema.
- For nullable fields: `type: ["string", "null"]` (OpenAPI 3.1 syntax).
- Do NOT change `info.title` — it controls generated filenames.

## Body Schema Naming (Avoid TS2308)

Orval auto-generates `<OperationIdPascal>Body` names. If your component schema has the same name, you get:
```
error TS2308: Module has already exported a member named 'CreateNoteBody'
```

**Rule:** Name body schemas after the entity, not the operation.
- ✅ `NoteInput`, `NoteUpdate`, `ProductInput`
- ❌ `CreateNoteBody`, `UpdateNoteBody`

## Using Generated Hooks

```tsx
import { useGetNotes, getGetNotesQueryKey } from "@workspace/api-client-react";

// Queries return data directly (no wrapper)
const { data, isLoading } = useGetNotes();

// Mutations take { data: T }
const mutation = useCreateNote();
mutation.mutate({ data: { title: "New" } });

// Cache invalidation
queryClient.invalidateQueries({ queryKey: getGetNotesQueryKey() });
```
