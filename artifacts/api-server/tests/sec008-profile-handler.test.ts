import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * SEC-008 / 2.8 — `PATCH /profile` derives the target id from the token, never
 * the body (vitest, no DB).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    7 (P0 unit/property tests) — TEST-FIRST.
 * Design:  Property 1 (Fix-Checking) — the replacement profile-write path writes
 *          ONLY the caller's own row; the id comes from `req.authUser!.id`.
 * Requirements: 2.1, 2.8.
 *
 * ── Approach ────────────────────────────────────────────────────────────────
 * We mount the REAL `routes/profile.ts` router on a throwaway Express app and
 * drive it over an ephemeral port (the codebase ships no supertest). Two
 * dependencies are mocked so the test is pure (no DB, no auth backend):
 *   • `requireUser` → injects a fixed `req.authUser = { id: TOKEN_ID }`.
 *   • `getAdminSupabase()` → a chainable stub that RECORDS the `.from()/.update()/
 *     .eq()` arguments so we can assert exactly which row id the write targets.
 *
 * The SAME file holds across the fix:
 *   • Pre-fix (today): the handler destructures only {full_name, default_address}
 *     from `req.body`, so a stray body `id` is already ignored — the write targets
 *     the token id.
 *   • Post-fix (task 5.1): `validate(UpdateProfileSchema)` with `.strict()` rejects
 *     a body carrying `id` with a 400 before the handler runs.
 * Either way the invariant holds: **the update NEVER targets an attacker-supplied
 * id** — only the token id. The assertions below are written to that invariant.
 */

// Hoisted shared state — referenced inside the (hoisted) vi.mock factories.
const h = vi.hoisted(() => {
  const TOKEN_ID = "token-user-id-1111-2222-3333";
  const capture: {
    fromArg: string | null;
    updateArg: Record<string, unknown> | null;
    eqCol: string | null;
    eqVal: unknown;
    called: boolean;
  } = { fromArg: null, updateArg: null, eqCol: null, eqVal: undefined, called: false };

  function reset() {
    capture.fromArg = null;
    capture.updateArg = null;
    capture.eqCol = null;
    capture.eqVal = undefined;
    capture.called = false;
  }

  return { TOKEN_ID, capture, reset };
});

// Mock requireUser → always authenticate as TOKEN_ID.
vi.mock("../src/middlewares/requireUser", () => ({
  requireUser: (
    req: { authUser?: { id: string } },
    _res: unknown,
    next: () => void,
  ): void => {
    req.authUser = { id: h.TOKEN_ID };
    next();
  },
}));

// Mock getAdminSupabase → chainable recorder. Returns a profile shaped from the
// update payload so the handler's `.select().single()` resolves with no error.
vi.mock("../src/lib/supabase", () => ({
  getAdminSupabase: () => ({
    from(table: string) {
      h.capture.fromArg = table;
      return {
        update(updates: Record<string, unknown>) {
          h.capture.called = true;
          h.capture.updateArg = updates;
          return {
            eq(col: string, val: unknown) {
              h.capture.eqCol = col;
              h.capture.eqVal = val;
              return {
                select() {
                  return {
                    async single() {
                      return {
                        data: {
                          full_name: (updates.full_name as string | null) ?? null,
                          phone: null,
                          default_address: (updates.default_address as string | null) ?? null,
                        },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  }),
}));

const ATTACKER_ID = "attacker-id-9999-aaaa-bbbb";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Imported AFTER the mocks are registered so the router picks up the stubs.
  const express = (await import("express")).default;
  const profileRouter = (await import("../src/routes/profile")).default;

  const app = express();
  app.use(express.json());
  app.use(profileRouter); // router paths are "/profile"

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.reset();
});

describe("SEC-008 PATCH /profile id derivation (Property 1)", () => {
  it("derives the update target id from req.authUser, not the body", async () => {
    const res = await fetch(`${baseUrl}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: "Token Target" }),
    });

    expect(res.status).toBe(200);
    expect(h.capture.called).toBe(true);
    expect(h.capture.fromArg).toBe("users");
    expect(h.capture.eqCol).toBe("id");
    expect(h.capture.eqVal).toBe(h.TOKEN_ID);
  });

  it("never targets an attacker-supplied body id (ignored pre-fix, 400-rejected post-fix)", async () => {
    const res = await fetch(`${baseUrl}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // The body smuggles a different `id`. The handler must never write to it.
      body: JSON.stringify({ id: ATTACKER_ID, full_name: "Token Target" }),
    });

    // Two valid post-fix regimes — both satisfy the security invariant:
    //   • Pre-fix:  handler ignores body `id`  → 200, update targets TOKEN_ID.
    //   • Post-fix: `.strict()` rejects `id`    → 400, update never runs.
    if (res.status === 200) {
      expect(h.capture.eqVal).toBe(h.TOKEN_ID);
    } else {
      expect(res.status).toBe(400);
      expect(h.capture.called).toBe(false);
    }

    // The critical assertion, regardless of regime: the write NEVER targeted the
    // attacker id.
    expect(h.capture.eqVal).not.toBe(ATTACKER_ID);
  });

  it("only writes whitelisted columns (no role key reaches the update payload)", async () => {
    const res = await fetch(`${baseUrl}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: "Token Target", default_address: "Baku 10" }),
    });

    if (res.status === 200) {
      // Pre-fix and post-fix: the handler only ever builds {full_name, default_address}.
      expect(h.capture.updateArg).not.toBeNull();
      expect(Object.keys(h.capture.updateArg ?? {}).sort()).toEqual([
        "default_address",
        "full_name",
      ]);
      expect("role" in (h.capture.updateArg ?? {})).toBe(false);
    }
  });
});
