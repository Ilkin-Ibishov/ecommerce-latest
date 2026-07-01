import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { errorHandler } from "../src/middlewares/errorHandler.js";

/**
 * OTP Verify Session 500 — bug-condition exploration (Property 1).
 *
 * Spec:    .kiro/specs/otp-verify-session-500  (bugfix)
 * Task:    1 (exploration) — re-run by task 3.2 (fix-check) via OTP_VERIFY_FIXED=1
 * Design:  Property 1 — verify never throws unhandled under the format/recover edge.
 * Requirements: 1.1 / 1.2 / 1.3 (current conditions), 2.1 / 2.2 / 2.3 (expected after fix).
 *
 * ── What this captures ────────────────────────────────────────────────────────
 *   `POST /api/auth/otp/verify` returns the central errorHandler's generic
 *   `500 {"error":"Internal server error"}` on production — which only fires for an
 *   UNHANDLED throw. The generic body proves the verify handler threw rather than
 *   hitting one of its own specific failure branches.
 *
 *   Leading hypothesis (bugfix.md / design.md, priority 1): the `createUser`
 *   "already exists" recovery branch in `src/routes/auth.ts` runs
 *       const { data: { users: allUsers } } = await admin.auth.admin.listUsers(...)
 *   and destructures `data.users` directly. When `data` is null/undefined this
 *   nested destructure raises a `TypeError` → unhandled throw → generic 500.
 *   (Exact line at time of writing: src/routes/auth.ts:64.)
 *
 *   This file encodes that hypothesis deterministically WITHOUT a DB by mocking
 *   the Supabase clients so the bug condition holds:
 *     • existingRow lookup  → { data: null }  (public.users row NOT matched)
 *     • createUser          → { error: "already registered" }  (Auth user EXISTS)
 *     • listUsers           → { data: null }  (the throw trigger)
 *   The test-bypass phone (+994550000001 / 999999) makes `verifyOTP` return
 *   `{valid:true}` immediately (lib/otp.ts TEST_PHONES), so the session-issuance
 *   block runs identically to production without WhatsApp/OTP-table involvement.
 *
 * ── Switchable expected outcome (exploration → fix-check) ──────────────────────
 *   • UNFIXED code (task 1, default):  OTP_VERIFY_FIXED unset/"0"
 *       → handler throws a TypeError on the null `listUsers` destructure →
 *         generic 500 {"error":"Internal server error"} (the captured counterexample).
 *   • FIXED code (task 3.1):           OTP_VERIFY_FIXED="1"
 *       → handler null-guards the recovery and returns either 200 + tokens or a
 *         SPECIFIC handled error (e.g. {"error":"Session creation failed"}),
 *         never the generic unhandled 500, and no error reaches the error middleware.
 *   Flip by setting OTP_VERIFY_FIXED=1 after the fix lands. No second file is written.
 *
 *   EXPECTED OUTCOME ON UNFIXED CODE: this suite FAILS to return tokens and instead
 *   captures the generic 500 + the exact TypeError — confirming the bug exists.
 */

const EXPECT_FIXED = process.env.OTP_VERIFY_FIXED === "1";

const TEST_PHONE = "+994550000001";
const TEST_CODE = "999999";

const GENERIC_500 = "Internal server error";

/**
 * The unhandled error captured as it forwards to the error middleware. On unfixed
 * code this is the `TypeError` from the null `listUsers` destructure (auth.ts:64);
 * the central errorHandler then masks it as the generic 500 in the response body,
 * so we capture it here to pin the exact throwing cause / stack.
 */
let capturedError: (Error & { stack?: string }) | null = null;

// ── Mock the Supabase clients to satisfy isBugCondition() deterministically. ──
//    verifyOTP is NOT mocked: the test-bypass phone short-circuits it to valid
//    before any DB access, so the real lib/otp.ts runs unchanged.
vi.mock("../src/lib/supabase", () => {
  // Chainable users-table query builder; the lookup resolves to { data: null }
  // so `existingRow` is null and execution enters the create/recover branch.
  const usersBuilder: Record<string, unknown> = {
    select: () => usersBuilder,
    eq: () => usersBuilder,
    maybeSingle: async () => ({ data: null, error: null }),
    upsert: async () => ({ data: null, error: null }),
  };
  const adminClient = {
    from: () => usersBuilder,
    auth: {
      admin: {
        // Auth user already exists → drives the createErr recovery branch.
        createUser: async () => ({
          data: null,
          error: { message: "A user with this phone number has already been registered" },
        }),
        // THE BUG TRIGGER (hypothesis 1): null `data` → `const { data: { users } } = …`
        // raises a TypeError on unfixed code.
        listUsers: async () => ({ data: null, error: null }),
        updateUserById: async () => ({ data: null, error: null }),
      },
    },
  };
  const anonClient = {
    auth: {
      // Only reached if the recovery resolves a user; provides a session so a
      // FIXED handler that recovers can still return 200 + tokens.
      signInWithPassword: async () => ({
        data: { session: { access_token: "exploration-access", refresh_token: "exploration-refresh" } },
        error: null,
      }),
    },
  };
  return {
    getAdminSupabase: () => adminClient,
    getSupabase: () => anonClient,
  };
});

/** Minimal app mirroring app.ts essentials: req.log shim → json → auth router →
 *  error-capture → real central errorHandler. No rate-limit/cors noise. */
async function buildApp(): Promise<Express> {
  const { default: authRouter } = await import("../src/routes/auth.js");
  const app = express();
  app.use((req, _res, next) => {
    // pino-http is absent here; the handler + errorHandler only use req.log.error/info.
    (req as unknown as { log: Record<string, () => void> }).log = {
      error: () => {},
      info: () => {},
      warn: () => {},
      debug: () => {},
    };
    next();
  });
  app.use(express.json());
  app.use("/api", authRouter);
  // Capture the unhandled error BEFORE the central handler masks it as a generic 500.
  app.use((err: Error, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
    capturedError = err;
    next(err);
  });
  app.use(errorHandler);
  return app;
}

describe("OTP Verify 500 exploration: null listUsers recovery throws unhandled (Property 1)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await buildApp();
    await new Promise<void>((resolveListen) => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolveListen();
      });
    });
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    capturedError = null;
  });

  it(
    EXPECT_FIXED
      ? "FIXED: bug-condition verify returns 200 + tokens or a specific handled error (never a generic unhandled 500)"
      : "UNFIXED: bug-condition verify throws unhandled → generic 500 (captures the counterexample)",
    async () => {
      const res = await fetch(`${baseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: TEST_PHONE, code: TEST_CODE }),
      });
      const body = (await res.json()) as { error?: string; access_token?: string; refresh_token?: string };

      if (EXPECT_FIXED) {
        // Property 1 (fix-check): 200 + non-null tokens OR a specific handled error.
        const handledOk =
          res.status === 200 && Boolean(body.access_token) && Boolean(body.refresh_token);
        const handledErr =
          res.status >= 400 && Boolean(body.error) && body.error !== GENERIC_500;
        expect(handledOk || handledErr).toBe(true);
        // No unhandled throw reached the error middleware.
        expect(capturedError).toBeNull();
      } else {
        // EXPLORATION (unfixed): the counterexample — generic 500 from an unhandled throw.
        expect(res.status).toBe(500);
        expect(body.error).toBe(GENERIC_500);
        // The throw must NOT yield tokens.
        expect(body.access_token).toBeUndefined();
        expect(body.refresh_token).toBeUndefined();
        // Pin the exact cause: a TypeError from the null `listUsers` destructure
        // at auth.ts:64. The message wording varies by transform (native ESM emits
        // "Cannot destructure property 'users' …"; the bundled/lowered form emits
        // "Cannot read properties of null (reading 'users')") — both name `users`.
        expect(capturedError).toBeInstanceOf(TypeError);
        expect(capturedError?.message ?? "").toMatch(
          /(Cannot destructure property 'users')|(Cannot read properties of null \(reading 'users'\))/,
        );
      }
    },
  );
});

describe("OTP Verify 500 exploration: root-cause documentation (hypothesis 1)", () => {
  it("destructuring `users` from a null listUsers `data` is a TypeError (mirrors auth.ts:64)", () => {
    // Documents the precise failure mode independent of the server: this is the
    // raw JS semantics the production handler hits when listUsers().data is null.
    const listUsersResult = { data: null as null } as { data: { users: unknown[] } | null };
    expect(() => {
      const {
        data: { users: _allUsers },
      } = listUsersResult as unknown as { data: { users: unknown[] } };
      void _allUsers;
    }).toThrow(TypeError);
  });
});
