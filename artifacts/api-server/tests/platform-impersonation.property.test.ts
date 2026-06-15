import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 20: Impersonation grants read-only single-Store access bounded in time

import {
  evaluateImpersonation,
  type EvaluateImpersonationInput,
} from "../src/lib/platform/impersonation";

// ─── Generators ────────────────────────────────────────────────────────────────

const storeIdArb = fc.uuid();

const impersonationInputArb: fc.Arbitrary<EvaluateImpersonationInput> = fc.record({
  sessionActive: fc.boolean(),
  expired: fc.boolean(),
  ended: fc.boolean(),
  targetStoreId: storeIdArb,
  requestedStoreId: storeIdArb,
  isWrite: fc.boolean(),
});

// ─── Property 20: Impersonation grants read-only single-Store access bounded in time ──

describe("Feature: super-admin-platform, Property 20: Impersonation grants read-only single-Store access bounded in time", () => {
  describe("ended → reject", () => {
    it("session that has been ended → denied with reason session_ended", () => {
      fc.assert(
        fc.property(
          storeIdArb,
          storeIdArb,
          fc.boolean(),
          fc.boolean(),
          (targetStore, requestedStore, expired, isWrite) => {
            const input: EvaluateImpersonationInput = {
              sessionActive: true, // even if active flag is true, ended takes priority
              expired,
              ended: true,
              targetStoreId: targetStore,
              requestedStoreId: requestedStore,
              isWrite,
            };
            const result = evaluateImpersonation(input);
            expect(result.allowed).toBe(false);
            if (!result.allowed) {
              expect(result.httpStatus).toBe(403);
              expect(result.reason).toBe("session_ended");
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("sessionActive=false → denied with reason session_ended", () => {
      fc.assert(
        fc.property(
          storeIdArb,
          storeIdArb,
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          (targetStore, requestedStore, expired, ended, isWrite) => {
            const input: EvaluateImpersonationInput = {
              sessionActive: false,
              expired,
              ended,
              targetStoreId: targetStore,
              requestedStoreId: requestedStore,
              isWrite,
            };
            const result = evaluateImpersonation(input);
            expect(result.allowed).toBe(false);
            if (!result.allowed) {
              expect(result.httpStatus).toBe(403);
              expect(result.reason).toBe("session_ended");
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("expired → reject", () => {
    it("active session that has expired → denied with reason session_expired", () => {
      fc.assert(
        fc.property(storeIdArb, fc.boolean(), (storeId, isWrite) => {
          const input: EvaluateImpersonationInput = {
            sessionActive: true,
            expired: true,
            ended: false,
            targetStoreId: storeId,
            requestedStoreId: storeId,
            isWrite,
          };
          const result = evaluateImpersonation(input);
          expect(result.allowed).toBe(false);
          if (!result.allowed) {
            expect(result.httpStatus).toBe(403);
            expect(result.reason).toBe("session_expired");
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("wrong store → reject", () => {
    it("active, non-expired session accessing a different store → denied with reason wrong_store", () => {
      fc.assert(
        fc.property(
          storeIdArb,
          storeIdArb.filter((id) => id.length > 0),
          fc.boolean(),
          (targetStore, requestedStore, isWrite) => {
            // Ensure they are different
            fc.pre(targetStore !== requestedStore);
            const input: EvaluateImpersonationInput = {
              sessionActive: true,
              expired: false,
              ended: false,
              targetStoreId: targetStore,
              requestedStoreId: requestedStore,
              isWrite,
            };
            const result = evaluateImpersonation(input);
            expect(result.allowed).toBe(false);
            if (!result.allowed) {
              expect(result.httpStatus).toBe(403);
              expect(result.reason).toBe("wrong_store");
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("write → reject", () => {
    it("active, non-expired session on correct store with write operation → denied with reason write_rejected", () => {
      fc.assert(
        fc.property(storeIdArb, (storeId) => {
          const input: EvaluateImpersonationInput = {
            sessionActive: true,
            expired: false,
            ended: false,
            targetStoreId: storeId,
            requestedStoreId: storeId,
            isWrite: true,
          };
          const result = evaluateImpersonation(input);
          expect(result.allowed).toBe(false);
          if (!result.allowed) {
            expect(result.httpStatus).toBe(403);
            expect(result.reason).toBe("write_rejected");
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("read correct store active → allow", () => {
    it("active, non-expired, correct store, read operation → allowed", () => {
      fc.assert(
        fc.property(storeIdArb, (storeId) => {
          const input: EvaluateImpersonationInput = {
            sessionActive: true,
            expired: false,
            ended: false,
            targetStoreId: storeId,
            requestedStoreId: storeId,
            isWrite: false,
          };
          const result = evaluateImpersonation(input);
          expect(result.allowed).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("priority ordering", () => {
    it("ended takes priority over expired, wrong_store, and write", () => {
      fc.assert(
        fc.property(impersonationInputArb, (input) => {
          const endedInput = { ...input, ended: true, sessionActive: true };
          const result = evaluateImpersonation(endedInput);
          expect(result.allowed).toBe(false);
          if (!result.allowed) {
            expect(result.reason).toBe("session_ended");
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
