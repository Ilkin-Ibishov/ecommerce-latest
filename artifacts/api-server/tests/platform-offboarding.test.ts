// Unit tests for lib/platform/offboarding.ts — offboarding state machine and guards
// Feature: super-admin-platform
// Requirements: 16.1, 16.3, 16.4, 16.5, 16.6, 16.9

import { describe, it, expect } from "vitest";
import {
  initiateOffboarding,
  restoreOffboarding,
  checkExportAllowed,
  purgeOffboarding,
  checkRetentionExpiry,
  resolvePhase,
  canInitiateOffboarding,
  canRestore,
  canExport,
  canPurge,
  computeRetentionEnd,
  RETENTION_DAYS,
  PURGE_WINDOW_HOURS,
  type OffboardingRecord,
} from "../src/lib/platform/offboarding";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<OffboardingRecord> = {}): OffboardingRecord {
  return {
    storeId: "store-abc",
    phase: "retention",
    initiatedAt: "2024-03-01T00:00:00.000Z",
    retentionEndsAt: "2024-03-31T00:00:00.000Z",
    preOffboardingStatus: "active",
    purgedAt: null,
    restoredAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// initiateOffboarding
// ---------------------------------------------------------------------------

describe("initiateOffboarding", () => {
  it("creates a 30-day retention record for a new offboarding (R16.1)", () => {
    const result = initiateOffboarding(
      "store-abc",
      "active",
      "2024-03-01T00:00:00.000Z",
      null
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.record.storeId).toBe("store-abc");
      expect(result.record.phase).toBe("retention");
      expect(result.record.preOffboardingStatus).toBe("active");
      expect(result.record.initiatedAt).toBe("2024-03-01T00:00:00.000Z");
      expect(result.record.retentionEndsAt).toBe("2024-03-31T00:00:00.000Z");
      expect(result.record.purgedAt).toBeNull();
      expect(result.record.restoredAt).toBeNull();
    }
  });

  it("preserves any platform_status as the pre-offboarding status", () => {
    const result = initiateOffboarding(
      "store-xyz",
      "suspended",
      "2024-06-15T12:00:00.000Z",
      null
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.record.preOffboardingStatus).toBe("suspended");
    }
  });

  it("rejects re-initiation if already in retention", () => {
    const existing = makeRecord();
    const result = initiateOffboarding(
      "store-abc",
      "active",
      "2024-03-15T00:00:00.000Z",
      existing
    );
    expect(result).toEqual({ success: false, reason: "already_offboarding" });
  });

  it("rejects re-initiation if retention has expired", () => {
    const existing = makeRecord();
    const result = initiateOffboarding(
      "store-abc",
      "active",
      "2024-04-15T00:00:00.000Z", // after retention ends
      existing
    );
    expect(result).toEqual({ success: false, reason: "already_offboarding" });
  });

  it("rejects initiation if store is already purged", () => {
    const existing = makeRecord({ phase: "purged", purgedAt: "2024-04-01T00:00:00.000Z" });
    const result = initiateOffboarding(
      "store-abc",
      "active",
      "2024-05-01T00:00:00.000Z",
      existing
    );
    expect(result).toEqual({ success: false, reason: "already_purged" });
  });

  it("allows re-initiation after a successful restore (record becomes active)", () => {
    const restored = makeRecord({ phase: "active", restoredAt: "2024-03-20T00:00:00.000Z" });
    const result = initiateOffboarding(
      "store-abc",
      "active",
      "2024-04-01T00:00:00.000Z",
      restored
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// restoreOffboarding
// ---------------------------------------------------------------------------

describe("restoreOffboarding", () => {
  it("restores to pre-offboarding status when within retention window (R16.3)", () => {
    const record = makeRecord({ preOffboardingStatus: "active" });
    const result = restoreOffboarding(record, "2024-03-15T00:00:00.000Z");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.restoredStatus).toBe("active");
      expect(result.record.phase).toBe("active");
      expect(result.record.restoredAt).toBe("2024-03-15T00:00:00.000Z");
    }
  });

  it("restores suspended pre-offboarding status with records intact (R16.5)", () => {
    const record = makeRecord({ preOffboardingStatus: "suspended" });
    const result = restoreOffboarding(record, "2024-03-20T00:00:00.000Z");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.restoredStatus).toBe("suspended");
      // Records remain intact — storeId, initiatedAt, etc. still present
      expect(result.record.storeId).toBe("store-abc");
    }
  });

  it("rejects restore when no offboarding record exists", () => {
    const result = restoreOffboarding(null, "2024-03-15T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "not_offboarding" });
  });

  it("rejects restore after retention window expires (R16.4)", () => {
    const record = makeRecord();
    const result = restoreOffboarding(record, "2024-04-01T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "retention_expired" });
  });

  it("rejects restore of a purged store as irrecoverable (R16.5)", () => {
    const record = makeRecord({ phase: "purged", purgedAt: "2024-04-02T00:00:00.000Z" });
    const result = restoreOffboarding(record, "2024-04-05T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "irrecoverable" });
  });

  it("rejects restore when record phase is active (not offboarding)", () => {
    const record = makeRecord({ phase: "active" });
    const result = restoreOffboarding(record, "2024-03-15T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "not_offboarding" });
  });
});

// ---------------------------------------------------------------------------
// checkExportAllowed
// ---------------------------------------------------------------------------

describe("checkExportAllowed", () => {
  it("allows export during retention window", () => {
    const record = makeRecord();
    const result = checkExportAllowed(record, "2024-03-15T00:00:00.000Z");
    expect(result).toEqual({ success: true });
  });

  it("rejects export after retention window expires (R16.9)", () => {
    const record = makeRecord();
    const result = checkExportAllowed(record, "2024-04-01T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "retention_expired" });
  });

  it("rejects export for a purged store", () => {
    const record = makeRecord({ phase: "purged", purgedAt: "2024-04-02T00:00:00.000Z" });
    const result = checkExportAllowed(record, "2024-05-01T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "purged" });
  });

  it("rejects export when no offboarding record exists", () => {
    const result = checkExportAllowed(null, "2024-03-15T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "not_offboarding" });
  });

  it("rejects export when record phase is active (not offboarding)", () => {
    const record = makeRecord({ phase: "active" });
    const result = checkExportAllowed(record, "2024-03-15T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "not_offboarding" });
  });
});

// ---------------------------------------------------------------------------
// purgeOffboarding
// ---------------------------------------------------------------------------

describe("purgeOffboarding", () => {
  it("purges when confirmation matches target store during retention (R16.6)", () => {
    const record = makeRecord();
    const result = purgeOffboarding(record, "store-abc", "2024-03-20T00:00:00.000Z");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.record.phase).toBe("purged");
      expect(result.record.purgedAt).toBe("2024-03-20T00:00:00.000Z");
    }
  });

  it("purges when confirmation matches after retention expires", () => {
    const record = makeRecord();
    const result = purgeOffboarding(record, "store-abc", "2024-04-05T00:00:00.000Z");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.record.phase).toBe("purged");
    }
  });

  it("rejects purge when confirmation does not match target store (R16.6)", () => {
    const record = makeRecord();
    const result = purgeOffboarding(record, "store-WRONG", "2024-03-20T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "confirmation_mismatch" });
  });

  it("rejects purge when no offboarding record exists", () => {
    const result = purgeOffboarding(null, "store-abc", "2024-03-20T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "not_offboarding" });
  });

  it("rejects purge when record is in active phase (not offboarding)", () => {
    const record = makeRecord({ phase: "active" });
    const result = purgeOffboarding(record, "store-abc", "2024-03-20T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "not_offboarding" });
  });

  it("rejects purge when store is already purged", () => {
    const record = makeRecord({ phase: "purged", purgedAt: "2024-04-02T00:00:00.000Z" });
    const result = purgeOffboarding(record, "store-abc", "2024-05-01T00:00:00.000Z");
    expect(result).toEqual({ success: false, reason: "already_purged" });
  });

  it("leaves records unchanged when confirmation mismatches", () => {
    const record = makeRecord();
    const originalPhase = record.phase;
    const originalPurgedAt = record.purgedAt;
    purgeOffboarding(record, "store-WRONG", "2024-03-20T00:00:00.000Z");
    // Original record is not mutated (pure function returns new object)
    expect(record.phase).toBe(originalPhase);
    expect(record.purgedAt).toBe(originalPurgedAt);
  });
});

// ---------------------------------------------------------------------------
// checkRetentionExpiry
// ---------------------------------------------------------------------------

describe("checkRetentionExpiry", () => {
  it("returns expired=false during retention window", () => {
    const record = makeRecord();
    const result = checkRetentionExpiry(record, "2024-03-15T00:00:00.000Z");
    expect(result).toEqual({ expired: false });
  });

  it("returns expired=true with purge deadline after retention ends (R16.4)", () => {
    const record = makeRecord();
    const result = checkRetentionExpiry(record, "2024-04-01T00:00:00.000Z");
    expect(result.expired).toBe(true);
    if (result.expired) {
      // Purge due within 24h of retention end
      expect(result.purgeDueBy).toBe(
        new Date(
          new Date("2024-03-31T00:00:00.000Z").getTime() +
            PURGE_WINDOW_HOURS * 60 * 60 * 1000
        ).toISOString()
      );
    }
  });

  it("returns expired=false for a purged record", () => {
    const record = makeRecord({ phase: "purged", purgedAt: "2024-04-02T00:00:00.000Z" });
    const result = checkRetentionExpiry(record, "2024-05-01T00:00:00.000Z");
    // Purged records don't have retention to check
    expect(result).toEqual({ expired: false });
  });

  it("returns expired=false for an active-phase record", () => {
    const record = makeRecord({ phase: "active" });
    const result = checkRetentionExpiry(record, "2024-04-15T00:00:00.000Z");
    expect(result).toEqual({ expired: false });
  });

  it("returns expired=true at exact retention end boundary", () => {
    const record = makeRecord();
    // Exactly at retentionEndsAt
    const result = checkRetentionExpiry(record, "2024-03-31T00:00:00.000Z");
    expect(result.expired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolvePhase
// ---------------------------------------------------------------------------

describe("resolvePhase", () => {
  it("returns purged for a purged record regardless of time", () => {
    const record = makeRecord({ phase: "purged", purgedAt: "2024-04-02T00:00:00.000Z" });
    expect(resolvePhase(record, "2024-03-01T00:00:00.000Z")).toBe("purged");
    expect(resolvePhase(record, "2025-01-01T00:00:00.000Z")).toBe("purged");
  });

  it("returns active for an active-phase record", () => {
    const record = makeRecord({ phase: "active" });
    expect(resolvePhase(record, "2024-03-15T00:00:00.000Z")).toBe("active");
  });

  it("returns retention when now is before retentionEndsAt", () => {
    const record = makeRecord();
    expect(resolvePhase(record, "2024-03-15T00:00:00.000Z")).toBe("retention");
  });

  it("returns retention_expired when now is at or after retentionEndsAt", () => {
    const record = makeRecord();
    expect(resolvePhase(record, "2024-03-31T00:00:00.000Z")).toBe("retention_expired");
    expect(resolvePhase(record, "2024-04-15T00:00:00.000Z")).toBe("retention_expired");
  });

  it("returns retention one millisecond before expiry", () => {
    const record = makeRecord();
    expect(resolvePhase(record, "2024-03-30T23:59:59.999Z")).toBe("retention");
  });
});

// ---------------------------------------------------------------------------
// Integration / Scenario tests
// ---------------------------------------------------------------------------

describe("offboarding lifecycle scenarios", () => {
  it("full lifecycle: initiate → export → purge", () => {
    // 1. Initiate
    const init = initiateOffboarding("store-1", "active", "2024-01-01T00:00:00.000Z", null);
    expect(init.success).toBe(true);
    if (!init.success) return;

    // 2. Export allowed during retention
    const exportCheck = checkExportAllowed(init.record, "2024-01-15T00:00:00.000Z");
    expect(exportCheck).toEqual({ success: true });

    // 3. Purge with correct confirmation
    const purge = purgeOffboarding(init.record, "store-1", "2024-01-20T00:00:00.000Z");
    expect(purge.success).toBe(true);
    if (!purge.success) return;

    // 4. After purge: restore is irrecoverable
    const restore = restoreOffboarding(purge.record, "2024-01-25T00:00:00.000Z");
    expect(restore).toEqual({ success: false, reason: "irrecoverable" });

    // 5. After purge: export is rejected
    const exportAfter = checkExportAllowed(purge.record, "2024-01-25T00:00:00.000Z");
    expect(exportAfter).toEqual({ success: false, reason: "purged" });
  });

  it("full lifecycle: initiate → restore before window", () => {
    // 1. Initiate
    const init = initiateOffboarding("store-2", "suspended", "2024-06-01T00:00:00.000Z", null);
    expect(init.success).toBe(true);
    if (!init.success) return;

    // 2. Restore within window
    const restore = restoreOffboarding(init.record, "2024-06-15T00:00:00.000Z");
    expect(restore.success).toBe(true);
    if (!restore.success) return;
    expect(restore.restoredStatus).toBe("suspended");
  });

  it("full lifecycle: initiate → window expires → export rejected", () => {
    // 1. Initiate
    const init = initiateOffboarding("store-3", "active", "2024-02-01T00:00:00.000Z", null);
    expect(init.success).toBe(true);
    if (!init.success) return;

    // 2. Time passes beyond retention
    const exportCheck = checkExportAllowed(init.record, "2024-03-10T00:00:00.000Z");
    expect(exportCheck).toEqual({ success: false, reason: "retention_expired" });

    // 3. Retention check confirms expired with purge deadline
    const retCheck = checkRetentionExpiry(init.record, "2024-03-10T00:00:00.000Z");
    expect(retCheck.expired).toBe(true);
  });

  it("RETENTION_DAYS is 30", () => {
    expect(RETENTION_DAYS).toBe(30);
  });

  it("PURGE_WINDOW_HOURS is 24", () => {
    expect(PURGE_WINDOW_HOURS).toBe(24);
  });
});


// ---------------------------------------------------------------------------
// canInitiateOffboarding — Property 27 guard
// ---------------------------------------------------------------------------

describe("canInitiateOffboarding", () => {
  it("returns true for 'active' status", () => {
    expect(canInitiateOffboarding("active")).toBe(true);
  });

  it("returns true for 'suspended' status", () => {
    expect(canInitiateOffboarding("suspended")).toBe(true);
  });

  it("returns true for 'disabled' status", () => {
    expect(canInitiateOffboarding("disabled")).toBe(true);
  });

  it("returns false for 'onboarding' status", () => {
    expect(canInitiateOffboarding("onboarding")).toBe(false);
  });

  it("returns false for unknown/empty status", () => {
    expect(canInitiateOffboarding("")).toBe(false);
    expect(canInitiateOffboarding("unknown")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canRestore — Property 27 guard
// ---------------------------------------------------------------------------

describe("canRestore", () => {
  it("returns success when not purged and retention has not ended (R16.3)", () => {
    const result = canRestore({ purged: false, retentionEnded: false });
    expect(result).toEqual({ success: true });
  });

  it("returns failure when purged (R16.5 — irrecoverable)", () => {
    const result = canRestore({ purged: true, retentionEnded: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("irrecoverable");
    }
  });

  it("returns failure when retention has ended", () => {
    const result = canRestore({ purged: false, retentionEnded: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Retention period has ended");
    }
  });

  it("returns failure for purged even if retention has not ended", () => {
    const result = canRestore({ purged: true, retentionEnded: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("irrecoverable");
    }
  });
});

// ---------------------------------------------------------------------------
// canExport — Property 27 guard
// ---------------------------------------------------------------------------

describe("canExport", () => {
  it("returns success when not purged and retention has not ended", () => {
    const result = canExport({ purged: false, retentionEnded: false });
    expect(result).toEqual({ success: true });
  });

  it("returns failure when purged (R16.9)", () => {
    const result = canExport({ purged: true, retentionEnded: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("purged");
    }
  });

  it("returns failure when retention has ended (R16.9)", () => {
    const result = canExport({ purged: false, retentionEnded: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("no longer available for export");
    }
  });

  it("returns failure for purged with retention ended", () => {
    const result = canExport({ purged: true, retentionEnded: true });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canPurge — Property 27 guard
// ---------------------------------------------------------------------------

describe("canPurge", () => {
  it("returns success when confirmation matches expected (R16.6)", () => {
    const result = canPurge({ confirmation: "store-abc", expectedConfirmation: "store-abc" });
    expect(result).toEqual({ success: true });
  });

  it("returns failure when confirmation does not match (R16.6)", () => {
    const result = canPurge({ confirmation: "store-wrong", expectedConfirmation: "store-abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("does not match");
    }
  });

  it("returns failure for empty confirmation", () => {
    const result = canPurge({ confirmation: "", expectedConfirmation: "store-abc" });
    expect(result.success).toBe(false);
  });

  it("returns failure for case-sensitive mismatch", () => {
    const result = canPurge({ confirmation: "Store-ABC", expectedConfirmation: "store-abc" });
    expect(result.success).toBe(false);
  });

  it("returns success for exact match including special characters", () => {
    const result = canPurge({
      confirmation: "store-123-abc",
      expectedConfirmation: "store-123-abc",
    });
    expect(result).toEqual({ success: true });
  });
});

// ---------------------------------------------------------------------------
// computeRetentionEnd — Property 27 guard
// ---------------------------------------------------------------------------

describe("computeRetentionEnd", () => {
  it("adds exactly 30 calendar days to the initiation date (R16.1)", () => {
    const initiated = new Date("2024-03-01T00:00:00.000Z");
    const result = computeRetentionEnd(initiated);
    expect(result.toISOString()).toBe("2024-03-31T00:00:00.000Z");
  });

  it("handles month boundary correctly (January → February)", () => {
    const initiated = new Date("2024-01-15T12:30:00.000Z");
    const result = computeRetentionEnd(initiated);
    expect(result.toISOString()).toBe("2024-02-14T12:30:00.000Z");
  });

  it("handles year boundary (December → January next year)", () => {
    const initiated = new Date("2024-12-15T00:00:00.000Z");
    const result = computeRetentionEnd(initiated);
    expect(result.toISOString()).toBe("2025-01-14T00:00:00.000Z");
  });

  it("preserves time component", () => {
    const initiated = new Date("2024-06-01T14:30:45.123Z");
    const result = computeRetentionEnd(initiated);
    expect(result.getUTCHours()).toBe(14);
    expect(result.getUTCMinutes()).toBe(30);
    expect(result.getUTCSeconds()).toBe(45);
    expect(result.getUTCMilliseconds()).toBe(123);
  });

  it("does not mutate the input date", () => {
    const initiated = new Date("2024-03-01T00:00:00.000Z");
    const originalTime = initiated.getTime();
    computeRetentionEnd(initiated);
    expect(initiated.getTime()).toBe(originalTime);
  });

  it("returns a Date 30 days after any arbitrary date", () => {
    const initiated = new Date("2024-07-20T08:00:00.000Z");
    const result = computeRetentionEnd(initiated);
    const diffMs = result.getTime() - initiated.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(30);
  });
});
