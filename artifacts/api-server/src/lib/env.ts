/**
 * Shared Supabase environment-resolution utility (R16.1 / R16.2).
 *
 * Reproduces EXACTLY the precedence used today across the three duplication sites:
 *   - api-server: `artifacts/api-server/src/lib/supabase.ts`
 *   - store:      `artifacts/store/src/lib/supabase/client.ts`
 *   - test setup: `artifacts/api-server/tests/setup.ts`
 *
 * The function is pure: it takes a `source` object so it can be driven from
 * `process.env` (Node / api-server / tests) or `import.meta.env` (Vite / store)
 * without coupling to either environment.
 *
 * NOTE: This file is intentionally MIRRORED with `artifacts/store/src/lib/env.ts`.
 * The store is a browser/Vite package and api-server is a Node package; there is
 * no shared runtime-util package that both can import, so the identical pure
 * function lives in both packages. Keep the two copies byte-for-byte identical
 * until a shared util package exists. (R16.1)
 */
export function resolveSupabaseEnv(source: Record<string, string | undefined>): {
  url: string;
  anonKey: string;
  serviceKey: string;
} {
  return {
    url: source.VITE_SUPABASE_URL ?? source.SUPABASE_URL ?? "",
    anonKey: source.VITE_SUPABASE_ANON_KEY ?? source.SUPABASE_ANON_KEY ?? "",
    serviceKey: source.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
}

/**
 * Control_Plane Supabase environment resolution (R9.1, R9.7, R9.8).
 *
 * The Control_Plane uses a SEPARATE Supabase project from any Store.
 * These vars point to the Control_Plane database only — never a store DB.
 */
export function resolveControlPlaneEnv(source: Record<string, string | undefined>): {
  url: string;
  serviceKey: string;
} {
  return {
    url: source.CONTROL_PLANE_SUPABASE_URL ?? "",
    serviceKey: source.CONTROL_PLANE_SUPABASE_SERVICE_KEY ?? "",
  };
}
