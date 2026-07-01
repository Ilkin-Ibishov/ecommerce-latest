import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import fc from "fast-check";
import { errorHandler } from "../src/middlewares/errorHandler.js";

/**
 * OTP Verify Session 500 — Preservation (Property 2).
 *
 * Spec:    .kiro/specs/otp-verify-session-500  (bugfix)
 * Task:    2 (preservation, observation-first) — re-run by task 3.3 after the fix.
 * Design:  Property 2 — "Already-Linked Verify and Validation Branches Unchanged".
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * ── Methodology ───────────────────────────────────────────────────────────────
 *   Observation-first: this suite captures the CURRENT (unfixed) observable
 *   behavior of every `¬C` (NOT-bug-condition) branch of
 *   `POST /api/auth/otp/verify`, so the fix (task 3.1) can be proven to preserve
 *   it. All cases here are OUTSIDE the bug condition:
 *
 *     • Happy path (3.1) — `existingRow` found → `updateUserById` →
 *       `signInWithPassword` → 200 with non-null access_token / refresh_token.
 *       The create/recover branch (where the bug lives) is NEVER entered.
 *     • Invalid / expired code (3.2) → 400 {"error":"Verification failed", reason}.
 *     • Missing `phone` or `code` (3.3) → 400 {"error":"Phone and code are required"}.
 *     • Idempotent re-verify for an already-linked user (3.5) → fresh valid session.
 *
 *   EXPECTED OUTCOME ON UNFIXED CODE: every test PASSES (this is the baseline that
 *   the fix must keep green).
 *
 * ── No DB ─────────────────────────────────────────────────────────────────────
 *   The Supabase clients are mocked (mirrors otp-verify-500.exploration.test.ts).
 *   For the happy path the mock satisfies the already-linked branch:
 *     • users lookup (`maybeSingle`) → { data: { id } }  (existingRow FOUND)
 *     • updateUserById → success
 *     • signInWithPassword → a session with both tokens
 *   The 400 branches return before any admin client / DB work:
 *     • Invalid/expired code: the real lib/otp.ts dev in-memory store is empty
 *       (NODE_ENV=development via tests/setup.ts), so non-test phones / wrong codes
 *       yield { valid:false, reason:"not_found_or_expired" } with no DB access.
 *     • Missing fields: rejected by the `!phone || !code` guard up front.
 */

// The auth rate limiter (SEC-004, 10 req/min/IP) is created at module load and
// reads this flag once. The property tests fire many requests from one IP, so we
// bypass the limiter the same way the CI "Start API server" step does. Set BEFORE
// the auth router (and rateLimits) module is dynamically imported in beforeAll.
process.env.E2E_DISABLE_AUTH_RATELIMIT = "1";

// Hardcoded test-bypass phone (lib/otp.ts TEST_PHONES) → verifyOTP returns valid
// for code 999999 without WhatsApp / DB. Used for the already-linked happy path.
const TEST_PHONE = "+994550000001";
const TEST_CODE = "999999";
const TEST_PHONES = new Set(["+994550000001", "+994550000002", "+994550000003"]);

const GENERIC_500 = "Internal server error";

// ── Mutable mock state (hoisted so the vi.mock factory can close over it). ──────
const state = vi.hoisted(() => ({
  // existingRow returned by the users lookup. Truthy → already-linked happy path.
  existingRow: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
  // signInWithPassword result — a real-shaped session by default.
  signIn: {
    data: {
      session: {
        access_token: "preservation-access-token",
        refresh_token: "preservation-refresh-token",
      },
    },
    error: null as { message: string } | null,
  },
}));

// Mock the Supabase clients. verifyOTP is NOT mocked: the test-bypass phone
// short-circuits it to valid, and non-test phones fall through to the (empty)
// dev in-memory store, so the real lib/otp.ts runs unchanged.
vi.mock("../src/lib/supabase", () => {
  const usersBuilder: Record<string, unknown> = {
    select: () => usersBuilder,
    eq: () => usersBuilder,
    // Already-linked: existingRow is found → create/recover branch NOT entered.
    maybeSingle: async () => ({ data: state.existingRow, error: null }),
    upsert: async () => ({ data: null, error: null }),
  };
  const adminClient = {
    from: () => usersBuilder,
    auth: {
      admin: {
        createUser: async () => ({ data: null, error: null }),
        listUsers: async () => ({ data: { users: [] }, error: null }),
        updateUserById: async () => ({ data: null, error: null }),
      },
    },
  };
  const anonClient = {
    auth: {
      signInWithPassword: async () => state.signIn,
    },
  };
  return {
    getAdminSupabase: () => adminClient,
    getSupabase: () => anonClient,
  };
});

/** Minimal app mirroring app.ts essentials: req.log shim → json → auth router →
 *  error-capture → real central errorHandler (mirrors the exploration harness). */
let capturedError: (Error & { stack?: string }) | null = null;

async function buildApp(): Promise<Express> {
  const { default: authRouter } = await import("../src/routes/auth.js");
  const app = express();
  app.use((req, _res, next) => {
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
  // Capture any unhandled error before the central handler masks it as a 500.
  app.use((err: Error, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
    capturedError = err;
    next(err);
  });
  app.use(errorHandler);
  return app;
}

type VerifyBody = {
  success?: boolean;
  isNew?: boolean;
  error?: string;
  reason?: string;
  access_token?: string;
  refresh_token?: string;
};

describe("OTP Verify 500 preservation (Property 2): ¬C branches unchanged", () => {
  let server: Server;
  let baseUrl: string;

  async function postVerify(payload: Record<string, unknown>): Promise<{ status: number; body: VerifyBody }> {
    const res = await fetch(`${baseUrl}/api/auth/otp/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as VerifyBody;
    return { status: res.status, body };
  }

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
    // Reset to the already-linked happy-path defaults before each test (shuffle-safe).
    state.existingRow = { id: "00000000-0000-4000-8000-000000000001" };
    state.signIn = {
      data: {
        session: {
          access_token: "preservation-access-token",
          refresh_token: "preservation-refresh-token",
        },
      },
      error: null,
    };
  });

  // ── 3.1 Happy path: already-linked user → 200 + non-null tokens ───────────────
  it("PRESERVE 3.1: already-linked verify returns 200 with non-null access/refresh tokens", async () => {
    const { status, body } = await postVerify({ phone: TEST_PHONE, code: TEST_CODE });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.isNew).toBe(false); // existingRow found → not a new user
    expect(body.access_token).toBe("preservation-access-token");
    expect(body.refresh_token).toBe("preservation-refresh-token");
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    // No unhandled throw reached the error middleware.
    expect(capturedError).toBeNull();
  });

  // ── 3.5 Idempotent re-verify for a linked user → fresh valid session ──────────
  it("PRESERVE 3.5: re-verify for an already-linked user is idempotent (fresh valid session each time)", async () => {
    const first = await postVerify({ phone: TEST_PHONE, code: TEST_CODE });
    const second = await postVerify({ phone: TEST_PHONE, code: TEST_CODE });

    for (const r of [first, second]) {
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      expect(r.body.isNew).toBe(false);
      expect(r.body.access_token).toBeTruthy();
      expect(r.body.refresh_token).toBeTruthy();
    }
    expect(capturedError).toBeNull();
  });

  // ── 3.2 Invalid / expired code → 400 {"error":"Verification failed", reason} ──
  it("PRESERVE 3.2: invalid/expired code returns 400 Verification failed with a reason", async () => {
    // Non-test phone, valid AZ format, but no OTP was ever issued (dev store empty).
    const { status, body } = await postVerify({ phone: "+994551112233", code: "123456" });

    expect(status).toBe(400);
    expect(body.error).toBe("Verification failed");
    expect(body.reason).toBe("not_found_or_expired");
    expect(body.access_token).toBeUndefined();
    expect(capturedError).toBeNull();
  });

  // ── 3.3 Missing fields → 400 {"error":"Phone and code are required"} ──────────
  it("PRESERVE 3.3: missing phone returns 400 Phone and code are required", async () => {
    const { status, body } = await postVerify({ code: TEST_CODE });
    expect(status).toBe(400);
    expect(body.error).toBe("Phone and code are required");
  });

  it("PRESERVE 3.3: missing code returns 400 Phone and code are required", async () => {
    const { status, body } = await postVerify({ phone: TEST_PHONE });
    expect(status).toBe(400);
    expect(body.error).toBe("Phone and code are required");
  });

  it("PRESERVE 3.3: empty phone and code returns 400 Phone and code are required", async () => {
    const { status, body } = await postVerify({ phone: "", code: "" });
    expect(status).toBe(400);
    expect(body.error).toBe("Phone and code are required");
  });

  // ── 3.3 (property): assorted missing/blank combinations all hit the required guard ──
  it("PRESERVE 3.3 (property): any request with a missing/blank phone or code → 400 required", async () => {
    const fieldArb = fc.constantFrom<string | undefined>(undefined, "", "+994551112233");
    const codeArb = fc.constantFrom<string | undefined>(undefined, "", "123456");

    await fc.assert(
      fc.asyncProperty(fieldArb, codeArb, async (phone, code) => {
        // Constrain to the ¬C "required" domain: at least one falsy field so the
        // `!phone || !code` guard fires before verifyOTP / any DB work.
        fc.pre(!phone || !code);

        const payload: Record<string, unknown> = {};
        if (phone !== undefined) payload.phone = phone;
        if (code !== undefined) payload.code = code;

        const { status, body } = await postVerify(payload);
        expect(status).toBe(400);
        expect(body.error).toBe("Phone and code are required");
        // Never an unhandled throw / generic 500 for the validation branch.
        expect(body.error).not.toBe(GENERIC_500);
      }),
      { numRuns: 30 },
    );
    expect(capturedError).toBeNull();
  });

  // ── 3.2 (property): assorted non-test phones + wrong codes → 400 Verification failed ──
  it("PRESERVE 3.2 (property): assorted valid-format phones with wrong codes → 400 Verification failed", async () => {
    const suffixArb = fc.integer({ min: 100_000_000, max: 999_999_999 }); // 9 digits → +994XXXXXXXXX
    const codeArb = fc.integer({ min: 100_000, max: 999_999 }); // 6-digit code

    await fc.assert(
      fc.asyncProperty(suffixArb, codeArb, async (suffix, codeNum) => {
        const phone = `+994${suffix}`;
        const code = String(codeNum);
        // Exclude the only valid combo (test-bypass phone + 999999) so every
        // generated input is genuinely an invalid/expired code (¬C).
        fc.pre(!(TEST_PHONES.has(phone) && code === TEST_CODE));

        const { status, body } = await postVerify({ phone, code });
        expect(status).toBe(400);
        expect(body.error).toBe("Verification failed");
        // Dev in-memory store is empty → consistent reason across the domain.
        expect(body.reason).toBe("not_found_or_expired");
        expect(body.access_token).toBeUndefined();
      }),
      { numRuns: 40 },
    );
    expect(capturedError).toBeNull();
  });
});
