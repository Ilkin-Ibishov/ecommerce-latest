import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SEC-006 / SEC-007 — P2 canonical UNIT suite (vitest, no DB, no server).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    22 — "Unit tests for SEC-006 / SEC-007 (vitest, no DB)"
 * Design:  Property 6 (fail fast on missing service key),
 *          Property 7 (no control-plane credential in the browser bundle).
 * Requirements: 2.6, 2.7, 3.6.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RELATIONSHIP TO THE EXPLORATION FILE (no duplication — agent-behaviors rule #5)
 * ─────────────────────────────────────────────────────────────────────────────
 * `sec005-007-p2.exploration.test.ts` (task 17) already captures the UNFIXED-state
 * observations for SEC-006 / SEC-007 behind a manual `P2_FIXED` env toggle: with
 * `P2_FIXED` unset it asserts the DEFECT (silent anon fallback / credential
 * present); with `P2_FIXED=1` it asserts the fixed state. That file OWNS the
 * exploration (counterexample capture) and its toggle-gated fixed branch.
 *
 * THIS file is the dedicated task-22 unit file and owns the *canonical,
 * toggle-free, fixed-state contract* — the assertions describe POST-FIX behavior
 * UNCONDITIONALLY (no `P2_FIXED` flag). It mirrors how task 8's
 * `sec001-rls.integration.test.ts` added a self-detecting fixed-state check that
 * auto-activates the moment the fix lands, instead of relying on someone
 * remembering to flip an env var. Concretely:
 *
 *   • SEC-006 fail-fast (key unset → throw): asserted unconditionally here.
 *     RED until task 19 lands (`getAdminSupabase()` still has `serviceKey ||
 *     anonKey`); goes GREEN automatically once the fallback is removed. The
 *     exploration file only asserts this when `P2_FIXED=1` is manually set.
 *   • SEC-006 boot assertion (server does not reach `listen()` when the key is
 *     missing): NOT covered by the exploration file at all — added here. RED
 *     until task 19 wires the eager startup probe into `src/index.ts`.
 *   • SEC-006 [3.6] preservation (key SET → usable service-role client): an
 *     invariant — passes now AND after the fix. Not duplicated in the toggle.
 *   • SEC-007 bundle credential absence: asserted unconditionally here. RED until
 *     task 20.1 removes `VITE_CONTROL_PLANE_*` from `vercel.json`; goes GREEN
 *     automatically. The exploration file only asserts absence when `P2_FIXED=1`.
 *
 * TEST-FIRST CONTRACT: these tests are written BEFORE the fixes (tasks 19 / 20.1).
 * The fail-fast / boot / bundle-absence assertions are expected RED on current
 * code and turn GREEN once the corresponding fix lands. The [3.6] preservation
 * assertion is expected GREEN now. No fix code is implemented by this task.
 *
 * ── Determinism of the "key SET" case ────────────────────────────────────────
 * `tests/setup.ts` loads the repo-root `.env` and THROWS if
 * `SUPABASE_SERVICE_ROLE_KEY` is missing, so the service key is guaranteed
 * present for the suite. The "key unset" cases simulate the missing key with the
 * same approach the exploration file uses: delete the env var, `vi.resetModules()`,
 * then dynamically re-import the module (env is resolved once at module load via
 * `resolveSupabaseEnv(process.env)`).
 */

const ADMIN_SUPABASE_ERROR = /SUPABASE_SERVICE_ROLE_KEY/;

// ───────────────────────────────────────────────────────────────────────────
// SEC-006 — getAdminSupabase() fail-fast + [3.6] preservation (Property 6)
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-006 unit (task 22): getAdminSupabase() fail-fast on missing service key (Property 6)", () => {
  /**
   * Fix-Checking · Property 6 · Req 2.6.
   *
   * Bug condition: api-server startup with SUPABASE_SERVICE_ROLE_KEY UNSET.
   * Post-fix contract: getAdminSupabase() THROWS (no silent anon fallback).
   *
   * RED until task 19 removes `serviceKey || anonKey`. Canonical / toggle-free:
   * the assertion is unconditional, so it auto-goes-green when the fix lands.
   */
  it("THROWS when SUPABASE_SERVICE_ROLE_KEY is unset (no anon fallback)", async () => {
    const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      vi.resetModules();
      const mod = await import("../src/lib/supabase");

      // Post-fix behavior: fail fast rather than return an anon "admin" client.
      expect(() => mod.getAdminSupabase()).toThrow(ADMIN_SUPABASE_ERROR);
    } finally {
      if (original === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = original;
      vi.resetModules();
    }
  });

  /**
   * Preservation · Property 6 · Req 3.6.
   *
   * When the service key IS set, getAdminSupabase() returns a usable
   * service-role client (a real Supabase client exposing `.from`). This is an
   * INVARIANT: it holds on the current code AND after the fix — the fix only
   * removes the unset-key fallback, it does not change the key-present path.
   * Expected GREEN now and after task 19.
   */
  it("[3.6] returns a usable service-role client when the key IS set", async () => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    // setup.ts guarantees this; assert the precondition so a failure here is
    // attributed to env, not to the SUT.
    expect(serviceKey, "tests/setup.ts must provide SUPABASE_SERVICE_ROLE_KEY").toBeTruthy();

    vi.resetModules();
    try {
      const mod = await import("../src/lib/supabase");
      const client = mod.getAdminSupabase();

      expect(client).toBeTruthy();
      // A usable client exposes the PostgREST query builder entry point.
      expect(typeof client.from).toBe("function");
    } finally {
      vi.resetModules();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SEC-006 — boot/startup assertion (Property 6)
//   Verifies the real `src/index.ts` boot wiring: when the service key is
//   missing, the eager startup probe aborts BEFORE `app.listen()` is reached.
//   `./app` and `./lib/supabase` are isolated with vi.mock so no port is bound
//   and no DB/network is touched — this exercises index.ts control flow only.
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-006 unit (task 22): boot guard exits before listen() when the key is missing (Property 6)", () => {
  /**
   * Fix-Checking · Property 6 · Req 2.6.
   *
   * Post-fix contract (task 19): `src/index.ts` performs an eager service-role
   * probe during boot, so when SUPABASE_SERVICE_ROLE_KEY is unset the process
   * aborts (throws/exits) BEFORE `app.listen()` — the server never starts with a
   * degraded anon "admin" client.
   *
   * RED until task 19 wires the boot probe: today index.ts calls `app.listen()`
   * unconditionally, so the `listen` spy IS called → this fails. Once the eager
   * probe is added the import aborts before `listen()` → the spy is not called.
   */
  it("does not reach app.listen() when SUPABASE_SERVICE_ROLE_KEY is unset", async () => {
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const originalPort = process.env.PORT;
    const listen = vi.fn();
    try {
      // Arrange: valid PORT (so PORT is NOT the failure cause), key MISSING.
      process.env.PORT = "5000";
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      // Isolate the heavy app graph (no port bind) and force the service-role
      // probe to fail fast exactly as the post-fix getAdminSupabase() would.
      vi.doMock("../src/app", () => ({ default: { listen } }));
      vi.doMock("../src/lib/supabase", () => ({
        getAdminSupabase: () => {
          throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
        },
        getSupabase: () => ({}),
        requireAdmin: async () => null,
      }));
      vi.resetModules();

      // Importing index.ts runs the boot sequence. Post-fix it aborts before
      // listen(); pre-fix it reaches listen(). Tolerate either a thrown import
      // (fail-fast) — the assertion below is on whether listen() was reached.
      try {
        await import("../src/index");
      } catch {
        // A throwing boot is the fail-fast path; listen must still be unreached.
      }

      expect(listen).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../src/app");
      vi.doUnmock("../src/lib/supabase");
      if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
      if (originalPort === undefined) delete process.env.PORT;
      else process.env.PORT = originalPort;
      vi.resetModules();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SEC-007 — no control-plane credential in the storefront bundle (Property 7)
//   Pure file assertion: reads repo-root vercel.json at runtime.
// ───────────────────────────────────────────────────────────────────────────
describe("SEC-007 unit (task 22): vercel.json build env ships NO control-plane credential (Property 7)", () => {
  // tests/ → api-server → artifacts → repo root
  const vercelJsonPath = resolve(import.meta.dirname, "../../../vercel.json");

  function readBuildEnv(): Record<string, string> {
    const raw = readFileSync(vercelJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { build?: { env?: Record<string, string> } };
    return parsed.build?.env ?? {};
  }

  /**
   * Fix-Checking · Property 7 · Req 2.7.
   *
   * Post-fix contract (task 20.1): the storefront `build.env` in vercel.json
   * contains NO `VITE_CONTROL_PLANE_*` key, so no control-plane credential is
   * inlined into the browser bundle.
   *
   * RED until task 20.1 removes the keys; canonical / toggle-free → goes GREEN
   * automatically once they are gone.
   */
  it("contains no VITE_CONTROL_PLANE_* keys in build.env", () => {
    const env = readBuildEnv();
    const controlPlaneKeys = Object.keys(env).filter((k) =>
      k.startsWith("VITE_CONTROL_PLANE_"),
    );

    expect(controlPlaneKeys).toEqual([]);
  });

  /**
   * Fix-Checking · Property 7 · Req 2.7.
   * Explicit named-key assertion (the two credentials the exploration file
   * recorded as present today) — defends against a partial removal.
   */
  it("does not ship the named control-plane URL/anon-key credentials", () => {
    const env = readBuildEnv();

    expect(env.VITE_CONTROL_PLANE_SUPABASE_URL).toBeUndefined();
    expect(env.VITE_CONTROL_PLANE_SUPABASE_ANON_KEY).toBeUndefined();
  });
});
