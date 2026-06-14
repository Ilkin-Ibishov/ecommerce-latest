import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolveSupabaseEnv } from "../src/lib/env";

/**
 * Env Resolution Property Tests
 * Feature: architecture-refactoring, Property 10: Env resolution preserves the prior precedence
 *
 * **Validates: Requirements 16.2**
 *
 * For any source map with arbitrary presence/absence of VITE_-prefixed and
 * non-prefixed Supabase vars, `resolveSupabaseEnv(source)` returns:
 *   - url        = source.VITE_SUPABASE_URL        ?? source.SUPABASE_URL        ?? ""
 *   - anonKey    = source.VITE_SUPABASE_ANON_KEY   ?? source.SUPABASE_ANON_KEY   ?? ""
 *   - serviceKey = source.SUPABASE_SERVICE_ROLE_KEY ?? ""
 */

// ─── The five keys that participate in resolution ───────────────────────────────
const ENV_KEYS = [
  "VITE_SUPABASE_URL",
  "SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * Reference oracle implementing the `??` precedence independently of the
 * implementation under test. Mirrors the documented precedence exactly.
 */
function oracle(source: Record<string, string | undefined>): {
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
 * Generate a source record where each of the 5 keys is independently either
 * present (a random string, possibly empty) or absent (undefined / omitted).
 */
const sourceArb: fc.Arbitrary<Record<string, string | undefined>> = fc
  .tuple(
    ...ENV_KEYS.map(() => fc.option(fc.string(), { nil: undefined }))
  )
  .map((values) => {
    const source: Record<string, string | undefined> = {};
    ENV_KEYS.forEach((key, i) => {
      // Only include the key when present, so we also exercise the
      // "missing property" path (not just `undefined` values).
      if (values[i] !== undefined) {
        source[key] = values[i];
      }
    });
    return source;
  });

describe("Feature: architecture-refactoring, Property 10: Env resolution preserves the prior precedence", () => {
  it("resolveSupabaseEnv matches the reference precedence oracle for any source map", () => {
    fc.assert(
      fc.property(sourceArb, (source) => {
        expect(resolveSupabaseEnv(source)).toEqual(oracle(source));
      }),
      { numRuns: 200 },
    );
  });
});
