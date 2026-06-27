import { describe, it, expect, beforeAll } from "vitest";
import fc from "fast-check";
import type { ZodType } from "zod";

/**
 * SEC-008 / 2.8 — `UpdateProfileSchema` contract (vitest, no DB).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    7 (P0 unit/property tests) — TEST-FIRST: written BEFORE tasks 4/5 land.
 * Design:  Property 1 (Fix-Checking — role never client-writable) +
 *          Property 8 (Preservation — legitimate {full_name, default_address} edits).
 * Requirements: 2.1 (role immutable from client), 2.8 (authenticated profile-write endpoint).
 *
 * ── What this asserts (the POST-FIX contract from design.md SEC-008) ────────
 * The mandated schema is:
 *
 *   z.object({
 *     full_name:        z.string().trim().min(1).max(200).nullable().optional(),
 *     default_address:  z.string().trim().max(500).nullable().optional(),
 *   })
 *   .strict()                                  // loud 400 on stray keys (role/email/phone/id)
 *   .refine((b) => b.full_name !== undefined || b.default_address !== undefined,
 *           { message: "Nothing to update" }); // at least one field required
 *
 * `.strict()` is the API-edge mirror of the DB-layer role lockdown: a stray
 * `role` key yields a loud rejection instead of being silently stripped.
 *
 * ── Test-first / resilience note (per task guidance) ────────────────────────
 * `UpdateProfileSchema` does NOT exist yet (it is created by task 5.1, in either
 * `routes/schemas.ts` or co-located in `routes/profile.ts`). Rather than a static
 * `import` that would crash this file's collection, we resolve the schema lazily
 * from BOTH candidate locations in `beforeAll`. Until task 5.1 lands these tests
 * fail with a clear "schema not found (pending task 5.1)" message; once the
 * implementer adds the export in EITHER location the same file turns green with
 * no edit. This is the intended red-pending-fix state of the test-first contract.
 */

// Candidate modules the implementer (task 5.1) may define the schema in.
// design.md SEC-008: "New schema (e.g. routes/schemas.ts or inline in profile.ts)".
async function loadUpdateProfileSchema(): Promise<ZodType<unknown> | null> {
  const candidates: Array<() => Promise<Record<string, unknown>>> = [
    () => import("../src/routes/schemas"),
    () => import("../src/routes/profile"),
  ];
  for (const load of candidates) {
    try {
      const mod = await load();
      const schema = mod["UpdateProfileSchema"];
      if (schema && typeof (schema as ZodType<unknown>).safeParse === "function") {
        return schema as ZodType<unknown>;
      }
    } catch {
      // Module does not exist yet (pending task 5.1) — try the next candidate.
    }
  }
  return null;
}

describe("SEC-008 UpdateProfileSchema contract (Property 1 / Property 8)", () => {
  let schema: ZodType<unknown> | null = null;

  beforeAll(async () => {
    schema = await loadUpdateProfileSchema();
  });

  /** Fail with a clear, test-first message if the schema is not implemented yet. */
  function requireSchema(): ZodType<unknown> {
    if (!schema) {
      throw new Error(
        "UpdateProfileSchema not found in routes/schemas.ts or routes/profile.ts " +
          "(pending task 5.1 — this is the expected red state before the fix lands).",
      );
    }
    return schema;
  }

  // ─── Fix-Checking (Property 1): role/email/phone are never accepted ──────────

  it("rejects { role: 'admin' } with a strict failure (→ loud 400 via validate)", () => {
    const s = requireSchema();
    expect(s.safeParse({ role: "admin" }).success).toBe(false);
  });

  it("rejects a body that smuggles role alongside a valid field (proves .strict(), not just refine)", () => {
    const s = requireSchema();
    // { full_name } alone would pass refine; adding `role` must still fail → only
    // `.strict()` (reject unknown keys) explains this, not the at-least-one refine.
    expect(s.safeParse({ full_name: "Aysel", role: "admin" }).success).toBe(false);
  });

  it("rejects email / phone / id (non-whitelisted columns) via .strict()", () => {
    const s = requireSchema();
    expect(s.safeParse({ full_name: "Aysel", email: "a@b.c" }).success).toBe(false);
    expect(s.safeParse({ full_name: "Aysel", phone: "+994501234567" }).success).toBe(false);
    expect(s.safeParse({ full_name: "Aysel", id: "00000000-0000-0000-0000-000000000000" }).success).toBe(false);
  });

  // ─── Acceptance: the two whitelisted profile fields ──────────────────────────

  it("accepts { full_name } and preserves the value", () => {
    const s = requireSchema();
    const parsed = s.safeParse({ full_name: "Aysel Customer" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ full_name: "Aysel Customer" });
    }
  });

  it("accepts { default_address } and preserves the value", () => {
    const s = requireSchema();
    const parsed = s.safeParse({ default_address: "Baku, Nizami küç. 10" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ default_address: "Baku, Nizami küç. 10" });
    }
  });

  it("accepts a nullable full_name (clearing the field)", () => {
    const s = requireSchema();
    // `full_name: null` is a defined field, so refine passes; nullable allows null.
    expect(s.safeParse({ full_name: null }).success).toBe(true);
  });

  it("trims surrounding whitespace on accepted values", () => {
    const s = requireSchema();
    const parsed = s.safeParse({ full_name: "  Aysel  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as { full_name?: string }).full_name).toBe("Aysel");
    }
  });

  // ─── Bounds ──────────────────────────────────────────────────────────────────

  it("rejects an empty full_name (min 1 after trim)", () => {
    const s = requireSchema();
    expect(s.safeParse({ full_name: "" }).success).toBe(false);
    expect(s.safeParse({ full_name: "   " }).success).toBe(false);
  });

  it("rejects an over-long full_name (>200) and default_address (>500)", () => {
    const s = requireSchema();
    expect(s.safeParse({ full_name: "a".repeat(201) }).success).toBe(false);
    expect(s.safeParse({ default_address: "a".repeat(501) }).success).toBe(false);
  });

  // ─── refine: at least one field ──────────────────────────────────────────────

  it("rejects the empty object (refine: at least one of full_name/default_address)", () => {
    const s = requireSchema();
    expect(s.safeParse({}).success).toBe(false);
  });

  // ─── Property: identity-preserving + never emits role/email/phone ────────────

  /** A full_name that is trim-invariant and within 1..200 chars. */
  const fullNameArb = fc
    .string({ minLength: 1, maxLength: 200 })
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 1 && s.length <= 200);

  /** A default_address that is trim-invariant and within 0..500 chars. */
  const addressArb = fc
    .string({ minLength: 0, maxLength: 500 })
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length <= 500);

  /** At least one whitelisted field present (so the refine is satisfied). */
  const validBodyArb = fc.oneof(
    fc.record({ full_name: fullNameArb }),
    fc.record({ default_address: addressArb }),
    fc.record({ full_name: fullNameArb, default_address: addressArb }),
  );

  it("property: any valid {full_name?, default_address?} round-trips identically and never emits role/email/phone", () => {
    const s = requireSchema();
    fc.assert(
      fc.property(validBodyArb, (body) => {
        const parsed = s.safeParse(body);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        const data = parsed.data as Record<string, unknown>;

        // Identity preservation (Property 8): each provided field survives unchanged.
        if ("full_name" in body) expect(data.full_name).toBe(body.full_name);
        if ("default_address" in body) expect(data.default_address).toBe(body.default_address);

        // Fix-Checking (Property 1): the output is confined to the whitelist —
        // role/email/phone are NEVER present.
        const allowed = new Set(["full_name", "default_address"]);
        for (const key of Object.keys(data)) {
          expect(allowed.has(key)).toBe(true);
        }
        expect("role" in data).toBe(false);
        expect("email" in data).toBe(false);
        expect("phone" in data).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
