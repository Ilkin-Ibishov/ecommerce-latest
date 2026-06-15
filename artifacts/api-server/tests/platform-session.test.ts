import { describe, it, expect } from "vitest";
import {
  verifyMfaEnrollment,
  validateSession,
  SESSION_MAX_LIFETIME_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from "../src/lib/platform/session";

// Feature: super-admin-platform
// Unit tests for lib/platform/session.ts (Task 2.3)

describe("verifyMfaEnrollment", () => {
  it("successful verification enables MFA when not already enabled", () => {
    const result = verifyMfaEnrollment(true, false);
    expect(result.mfaEnabled).toBe(true);
    expect(result.changed).toBe(true);
  });

  it("successful verification on already-enabled account is idempotent", () => {
    const result = verifyMfaEnrollment(true, true);
    expect(result.mfaEnabled).toBe(true);
    expect(result.changed).toBe(false);
  });

  it("failed verification leaves MFA disabled when it was disabled", () => {
    const result = verifyMfaEnrollment(false, false);
    expect(result.mfaEnabled).toBe(false);
    expect(result.changed).toBe(false);
  });

  it("failed verification leaves MFA enabled when it was already enabled", () => {
    const result = verifyMfaEnrollment(false, true);
    expect(result.mfaEnabled).toBe(true);
    expect(result.changed).toBe(false);
  });
});

describe("validateSession", () => {
  const baseTime = new Date("2024-01-01T12:00:00Z");

  function makeInput(overrides: Partial<Parameters<typeof validateSession>[0]> = {}) {
    return {
      startedAt: new Date(baseTime.getTime() - 60_000), // started 1 min ago
      lastSeenAt: new Date(baseTime.getTime() - 5_000), // active 5s ago
      now: baseTime,
      mfaVerified: true,
      mfaRequired: true,
      ...overrides,
    };
  }

  it("grants access when all conditions are met", () => {
    const result = validateSession(makeInput());
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("denies with mfa_required when MFA is required but not verified", () => {
    const result = validateSession(makeInput({ mfaVerified: false }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("mfa_required");
  });

  it("grants when MFA is not required regardless of mfaVerified", () => {
    const result = validateSession(makeInput({ mfaRequired: false, mfaVerified: false }));
    expect(result.valid).toBe(true);
  });

  it("denies with lifetime_expiry at exactly 8 hours", () => {
    const result = validateSession(
      makeInput({
        startedAt: new Date(baseTime.getTime() - SESSION_MAX_LIFETIME_MS),
        lastSeenAt: new Date(baseTime.getTime() - 1_000),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("lifetime_expiry");
  });

  it("grants at 1ms before 8-hour lifetime", () => {
    const result = validateSession(
      makeInput({
        startedAt: new Date(baseTime.getTime() - SESSION_MAX_LIFETIME_MS + 1),
        lastSeenAt: new Date(baseTime.getTime() - 1_000),
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("denies with idle_timeout at exactly 15 minutes idle", () => {
    const result = validateSession(
      makeInput({
        lastSeenAt: new Date(baseTime.getTime() - SESSION_IDLE_TIMEOUT_MS),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("idle_timeout");
  });

  it("grants at 1ms before 15-minute idle timeout", () => {
    const result = validateSession(
      makeInput({
        lastSeenAt: new Date(baseTime.getTime() - SESSION_IDLE_TIMEOUT_MS + 1),
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("constants have the correct values", () => {
    expect(SESSION_MAX_LIFETIME_MS).toBe(8 * 60 * 60 * 1000);
    expect(SESSION_IDLE_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });

  it("mfa_required reason takes priority over lifetime_expiry", () => {
    const result = validateSession(
      makeInput({
        mfaVerified: false,
        startedAt: new Date(baseTime.getTime() - SESSION_MAX_LIFETIME_MS - 1000),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("mfa_required");
  });

  it("lifetime_expiry reason takes priority over idle_timeout", () => {
    const result = validateSession(
      makeInput({
        startedAt: new Date(baseTime.getTime() - SESSION_MAX_LIFETIME_MS),
        lastSeenAt: new Date(baseTime.getTime() - SESSION_IDLE_TIMEOUT_MS),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("lifetime_expiry");
  });
});
