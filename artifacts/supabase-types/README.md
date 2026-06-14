# @workspace/supabase-types

Single source of truth for the Supabase database TypeScript types in the
monorepo. Both `@workspace/store` and `@workspace/api-server` consume the
generated `Database` type and the `Tables<>` row-type helper from this package
so the typed Supabase client (`SupabaseClient<Database>`) and
`Tables<"products">`-derived row types resolve to one schema definition.

## Exports

```typescript
import type { Database, Tables } from "@workspace/supabase-types";

// Typed client
import type { SupabaseClient } from "@supabase/supabase-js";
type Client = SupabaseClient<Database>;

// Row types
type ProductRow = Tables<"products">;
type OrderRow = Tables<"orders">;
```

`src/index.ts` re-exports the generated `Database` type and defines the
convenience helper:

```typescript
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
```

## Regenerating the types

`src/database.types.ts` is **generated — do not edit by hand**. Regenerate it
whenever the database schema changes (i.e. whenever `supabase/schema.sql` or a
new migration in `supabase/migrations/` changes the live schema).

### Preferred: Supabase CLI (live schema)

Run from the repository root. Requires Supabase CLI access — either a project
ref + access token, or a running local stack:

```bash
# Against a remote project (set SUPABASE_PROJECT_ID + SUPABASE_ACCESS_TOKEN)
supabase gen types typescript --project-id "$SUPABASE_PROJECT_ID" \
  > artifacts/supabase-types/src/database.types.ts

# Or against a local supabase stack
supabase gen types typescript --local \
  > artifacts/supabase-types/src/database.types.ts
```

After regenerating, re-add the file header comment documenting the method, then
run `pnpm run typecheck` and `pnpm run test` to confirm the workspace stays
green.

### Fallback: derive from `supabase/schema.sql`

If the Supabase CLI is unavailable and no project ref / local stack is
reachable, hand-author `database.types.ts` from the canonical schema in
`supabase/schema.sql` (plus the migrations under `supabase/migrations/`),
matching the standard `supabase gen types typescript` output shape
(`Database` with `public.Tables`, `Enums`, `Functions`, plus the `Tables` /
`TablesInsert` / `TablesUpdate` helpers).

## How the current file was generated

The committed `src/database.types.ts` was generated from the **live schema**
(equivalent to `supabase gen types typescript`) because the local `supabase`
CLI binary was not installed. The live schema is ahead of the checked-in
`supabase/schema.sql` snapshot, so the generated types include tables/columns
not yet reflected there (for example `products.brand`, `product_specs`,
`pages`, `page_translations`, `site_settings`, and `banners`).
