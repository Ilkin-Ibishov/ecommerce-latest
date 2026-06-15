// @workspace/supabase-types — single source of truth for Supabase types.
//
// Both @workspace/store and @workspace/api-server consume `Database` and the
// `Tables<>` row-type helper from here so the typed Supabase client
// (`SupabaseClient<Database>`) and `Tables<"products">`-derived row types
// resolve to one generated schema.
//
// The `ControlPlaneDatabase` type represents the CONTROL_PLANE Supabase
// project's schema — a completely separate database from the store `Database`.

export type { Database } from "./database.types";
export type { Json } from "./database.types";

export type {
  ControlPlaneDatabase,
  ControlPlaneTables,
  ControlPlanJson,
} from "./control-plane-database.types";

import type { Database } from "./database.types";

/**
 * Row-type helper: resolve a table name to its `Row` shape.
 *
 * @example
 *   type ProductRow = Tables<"products">;
 */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
