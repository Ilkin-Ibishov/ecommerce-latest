import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 27: Offboarding retention, restore, and purge guards

import {
  canRestore,
  canExport,
  canPurge,
  computeRetentionEnd,
  canInitiateOffboarding,
  RETENTION_DAYS,
} from "../src/lib/platform/offboarding";

// ─── Generators ────────────────────────────────────────────────────────────────

const storeIdArb = fc.uuid();

const dateArb = fc.date({ min: new Date("2020-01-01"), max: new Date("2025-12-31") });

// ─── Property 27: Offboarding retention, restore, and purge guards ──────────────

describe("Feature: super-admin-platform, Property 27: Offboarding retention, restore, and purge guards", () => {
  describe("30-day retention window", () => {
    it("computeRetentionEnd always returns initiatedAt + 30 days", () => {
      fc.assert(
        fc.property(dateArb, (initiatedAt) => {
          const retentionEnd = computeRetentionEnd(initiatedAt);
          const expected = new Date(initiatedAt.getTime());
          expected.setUTCDate(expected.getUTCDate() + RETENTION_DAYS);
          expect(retentionEnd.getTime()).toBe(expected.getTime());
        }),
        { numRuns: 100 },
      );
    });

    it("only active/suspended/disabled stores can be offboarded", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("active", "suspended", "disabled"),
          (status) => {
            expect(canInitiateOffboarding(status)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("onboarding stores cannot be offboarded", () => {
      expect(canInitiateOffboarding("onboarding")).toBe(false);
    });
  });

  describe("restore before retention end", () => {
    it("not purged and retention not ended → restore allowed", () => {
      fc.assert(
        fc.property(fc.constant({ purged: false, retentionEnded: false }), (input) => {
          const result = canRestore(input);
          expect(result).toEqual({ success: true });
        }),
        { numRuns: 100 },
      );
    });

    it("purged → restore denied (irrecoverable)", () => {
      fc.assert(
        fc.property(fc.boolean(), (retentionEnded) => {
          const result = canRestore({ purged: true, retentionEnded });
          expect(result).toHaveProperty("success", false);
          if (!result.success) {
            expect(result.error).toContain("purged");
          }
        }),
        { numRuns: 100 },
      );
    });

    it("retention ended (not purged) → restore denied", () => {
      const result = canRestore({ purged: false, retentionEnded: true });
      expect(result).toHaveProperty("success", false);
      if (!result.success) {
        expect(result.error).toContain("Retention period has ended");
      }
    });
  });

  describe("export rejection after retention end", () => {
    it("not purged and retention not ended → export allowed", () => {
      fc.assert(
        fc.property(fc.constant({ purged: false, retentionEnded: false }), (input) => {
          const result = canExport(input);
          expect(result).toEqual({ success: true });
        }),
        { numRuns: 100 },
      );
    });

    it("retention ended → export denied", () => {
      const result = canExport({ purged: false, retentionEnded: true });
      expect(result).toHaveProperty("success", false);
      if (!result.success) {
        expect(result.error).toContain("no longer available");
      }
    });

    it("purged → export denied", () => {
      fc.assert(
        fc.property(fc.boolean(), (retentionEnded) => {
          const result = canExport({ purged: true, retentionEnded });
          expect(result).toHaveProperty("success", false);
          if (!result.success) {
            expect(result.error).toContain("purged");
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("purge only with confirmation", () => {
    it("confirmation matching expected → purge allowed", () => {
      fc.assert(
        fc.property(storeIdArb, (storeId) => {
          const result = canPurge({ confirmation: storeId, expectedConfirmation: storeId });
          expect(result).toEqual({ success: true });
        }),
        { numRuns: 100 },
      );
    });

    it("confirmation not matching expected → purge denied", () => {
      fc.assert(
        fc.property(storeIdArb, storeIdArb, (confirmation, expected) => {
          fc.pre(confirmation !== expected);
          const result = canPurge({ confirmation, expectedConfirmation: expected });
          expect(result).toHaveProperty("success", false);
          if (!result.success) {
            expect(result.error).toContain("Confirmation does not match");
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("combined invariants", () => {
    it("a purged store can never be restored or exported", () => {
      fc.assert(
        fc.property(fc.boolean(), (retentionEnded) => {
          const restoreResult = canRestore({ purged: true, retentionEnded });
          const exportResult = canExport({ purged: true, retentionEnded });
          expect(restoreResult).toHaveProperty("success", false);
          expect(exportResult).toHaveProperty("success", false);
        }),
        { numRuns: 100 },
      );
    });
  });
});
