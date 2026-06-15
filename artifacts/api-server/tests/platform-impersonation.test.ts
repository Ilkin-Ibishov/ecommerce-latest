import { describe, it, expect } from "vitest";
import {
  checkImpersonationAccess,
  evaluateImpersonation,
  isSessionExpired,
  IMPERSONATION_MAX_DURATION_MS,
  type ImpersonationSession,
  type ImpersonationAccessRequest,
  type EvaluateImpersonationInput,
} from "../src/lib/platform/impersonation";

// Feature: super-admin-platform
// Unit tests for lib/platform/impersonation.ts (Task 16.1)
// Requirements: 10.3, 10.4, 10.5, 10.7

const STORE_A = "store-aaa-111";
const STORE_B = "store-bbb-222";

function makeSession(overrides: Partial<ImpersonationSession> = {}): ImpersonationSession {
  return {
    sessionId: "session-001",
    targetStoreId: STORE_A,
    startedAt: new Date("2024-06-01T10:00:00Z"),
    ended: false,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ImpersonationAccessRequest> = {}): ImpersonationAccessRequest {
  return {
    requestedStoreId: STORE_A,
    operationType: "read",
    now: new Date("2024-06-01T10:30:00Z"), // 30 min into session
    ...overrides,
  };
}

// ─── isSessionExpired ───────────────────────────────────────────────────────────

describe("isSessionExpired", () => {
  it("returns false when session just started", () => {
    const start = new Date("2024-06-01T10:00:00Z");
    const now = new Date("2024-06-01T10:00:00Z");
    expect(isSessionExpired(start, now)).toBe(false);
  });

  it("returns false at 59 minutes 59 seconds", () => {
    const start = new Date("2024-06-01T10:00:00Z");
    const now = new Date(start.getTime() + IMPERSONATION_MAX_DURATION_MS - 1);
    expect(isSessionExpired(start, now)).toBe(false);
  });

  it("returns true at exactly 60 minutes", () => {
    const start = new Date("2024-06-01T10:00:00Z");
    const now = new Date(start.getTime() + IMPERSONATION_MAX_DURATION_MS);
    expect(isSessionExpired(start, now)).toBe(true);
  });

  it("returns true after 60 minutes", () => {
    const start = new Date("2024-06-01T10:00:00Z");
    const now = new Date(start.getTime() + IMPERSONATION_MAX_DURATION_MS + 60_000);
    expect(isSessionExpired(start, now)).toBe(true);
  });

  it("constant has correct value (60 minutes in ms)", () => {
    expect(IMPERSONATION_MAX_DURATION_MS).toBe(60 * 60 * 1000);
  });
});

// ─── checkImpersonationAccess ───────────────────────────────────────────────────

describe("checkImpersonationAccess", () => {
  // --- Happy path (R10.3 read + R10.4 correct store + R10.5 within time + R10.7 not ended) ---

  it("grants read access to the target store within time bounds", () => {
    const result = checkImpersonationAccess(makeSession(), makeRequest());
    expect(result.granted).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.statusCode).toBeUndefined();
  });

  it("grants read at 1ms before 60-minute expiry", () => {
    const session = makeSession();
    const request = makeRequest({
      now: new Date(session.startedAt.getTime() + IMPERSONATION_MAX_DURATION_MS - 1),
    });
    const result = checkImpersonationAccess(session, request);
    expect(result.granted).toBe(true);
  });

  // --- R10.3: write → 403, data unchanged ---

  it("rejects write operations with 403 and write_rejected reason", () => {
    const result = checkImpersonationAccess(
      makeSession(),
      makeRequest({ operationType: "write" }),
    );
    expect(result.granted).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.reason).toBe("write_rejected");
  });

  // --- R10.4: access confined to single Store ---

  it("rejects access to a different store with wrong_store reason", () => {
    const result = checkImpersonationAccess(
      makeSession({ targetStoreId: STORE_A }),
      makeRequest({ requestedStoreId: STORE_B }),
    );
    expect(result.granted).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.reason).toBe("wrong_store");
  });

  it("rejects write to a different store with wrong_store (checked before write)", () => {
    const result = checkImpersonationAccess(
      makeSession({ targetStoreId: STORE_A }),
      makeRequest({ requestedStoreId: STORE_B, operationType: "write" }),
    );
    expect(result.granted).toBe(false);
    expect(result.statusCode).toBe(403);
    // wrong_store is checked before write_rejected in priority order
    expect(result.reason).toBe("wrong_store");
  });

  // --- R10.5: 60-minute expiry ---

  it("rejects access at exactly 60 minutes with session_expired", () => {
    const session = makeSession();
    const request = makeRequest({
      now: new Date(session.startedAt.getTime() + IMPERSONATION_MAX_DURATION_MS),
    });
    const result = checkImpersonationAccess(session, request);
    expect(result.granted).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.reason).toBe("session_expired");
  });

  it("rejects access well after 60 minutes with session_expired", () => {
    const session = makeSession();
    const request = makeRequest({
      now: new Date(session.startedAt.getTime() + IMPERSONATION_MAX_DURATION_MS + 3_600_000),
    });
    const result = checkImpersonationAccess(session, request);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("session_expired");
  });

  // --- R10.7: ended session rejected ---

  it("rejects access on an explicitly ended session", () => {
    const result = checkImpersonationAccess(
      makeSession({ ended: true }),
      makeRequest(),
    );
    expect(result.granted).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.reason).toBe("session_ended");
  });

  it("rejects even reads on an ended session", () => {
    const result = checkImpersonationAccess(
      makeSession({ ended: true }),
      makeRequest({ operationType: "read" }),
    );
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("session_ended");
  });

  // --- Priority ordering ---

  it("session_ended takes priority over session_expired", () => {
    const session = makeSession({ ended: true });
    const request = makeRequest({
      now: new Date(session.startedAt.getTime() + IMPERSONATION_MAX_DURATION_MS + 1000),
    });
    const result = checkImpersonationAccess(session, request);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("session_ended");
  });

  it("session_expired takes priority over wrong_store", () => {
    const session = makeSession();
    const request = makeRequest({
      requestedStoreId: STORE_B,
      now: new Date(session.startedAt.getTime() + IMPERSONATION_MAX_DURATION_MS),
    });
    const result = checkImpersonationAccess(session, request);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("session_expired");
  });

  it("session_expired takes priority over write_rejected", () => {
    const session = makeSession();
    const request = makeRequest({
      operationType: "write",
      now: new Date(session.startedAt.getTime() + IMPERSONATION_MAX_DURATION_MS),
    });
    const result = checkImpersonationAccess(session, request);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("session_expired");
  });

  it("wrong_store takes priority over write_rejected", () => {
    const result = checkImpersonationAccess(
      makeSession({ targetStoreId: STORE_A }),
      makeRequest({ requestedStoreId: STORE_B, operationType: "write" }),
    );
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("wrong_store");
  });

  it("session_ended takes priority over all other denials", () => {
    const session = makeSession({ ended: true });
    const request = makeRequest({
      requestedStoreId: STORE_B,
      operationType: "write",
      now: new Date(session.startedAt.getTime() + IMPERSONATION_MAX_DURATION_MS + 1000),
    });
    const result = checkImpersonationAccess(session, request);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("session_ended");
  });
});


// ─── evaluateImpersonation (flat-input interface, Property 20) ──────────────────

describe("evaluateImpersonation", () => {
  const STORE_X = "store-xxx-001";
  const STORE_Y = "store-yyy-002";

  function makeInput(overrides: Partial<EvaluateImpersonationInput> = {}): EvaluateImpersonationInput {
    return {
      sessionActive: true,
      expired: false,
      ended: false,
      targetStoreId: STORE_X,
      requestedStoreId: STORE_X,
      isWrite: false,
      ...overrides,
    };
  }

  // --- Happy path: read, correct store, active, not expired, not ended ---

  it("allows read access to target store within an active non-expired session", () => {
    const result = evaluateImpersonation(makeInput());
    expect(result).toEqual({ allowed: true });
  });

  // --- R10.3: write → 403, data unchanged ---

  it("rejects write operations with 403 and write_rejected reason", () => {
    const result = evaluateImpersonation(makeInput({ isWrite: true }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "write_rejected" });
  });

  // --- R10.4: access confined to single Store ---

  it("rejects access to a different store with wrong_store reason", () => {
    const result = evaluateImpersonation(makeInput({ requestedStoreId: STORE_Y }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "wrong_store" });
  });

  it("rejects write to a different store with wrong_store (higher priority)", () => {
    const result = evaluateImpersonation(makeInput({
      requestedStoreId: STORE_Y,
      isWrite: true,
    }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "wrong_store" });
  });

  // --- R10.5: 60-minute expiry ---

  it("rejects access on an expired session", () => {
    const result = evaluateImpersonation(makeInput({ expired: true }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "session_expired" });
  });

  it("expired takes priority over wrong_store", () => {
    const result = evaluateImpersonation(makeInput({
      expired: true,
      requestedStoreId: STORE_Y,
    }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "session_expired" });
  });

  it("expired takes priority over write_rejected", () => {
    const result = evaluateImpersonation(makeInput({
      expired: true,
      isWrite: true,
    }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "session_expired" });
  });

  // --- R10.7: ended session rejected ---

  it("rejects access on an ended session", () => {
    const result = evaluateImpersonation(makeInput({ ended: true }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "session_ended" });
  });

  it("rejects when sessionActive is false", () => {
    const result = evaluateImpersonation(makeInput({ sessionActive: false }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "session_ended" });
  });

  it("ended takes priority over expired", () => {
    const result = evaluateImpersonation(makeInput({
      ended: true,
      expired: true,
    }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "session_ended" });
  });

  it("ended takes priority over all other denials combined", () => {
    const result = evaluateImpersonation(makeInput({
      ended: true,
      expired: true,
      requestedStoreId: STORE_Y,
      isWrite: true,
    }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "session_ended" });
  });

  it("sessionActive=false takes priority over all other denials combined", () => {
    const result = evaluateImpersonation(makeInput({
      sessionActive: false,
      expired: true,
      requestedStoreId: STORE_Y,
      isWrite: true,
    }));
    expect(result).toEqual({ allowed: false, httpStatus: 403, reason: "session_ended" });
  });

  // --- httpStatus is always 403 on denial ---

  it("always returns httpStatus 403 when denied", () => {
    const denials: EvaluateImpersonationInput[] = [
      makeInput({ ended: true }),
      makeInput({ sessionActive: false }),
      makeInput({ expired: true }),
      makeInput({ requestedStoreId: STORE_Y }),
      makeInput({ isWrite: true }),
    ];
    for (const input of denials) {
      const result = evaluateImpersonation(input);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.httpStatus).toBe(403);
        expect(result.reason).toBeTruthy();
      }
    }
  });
});
