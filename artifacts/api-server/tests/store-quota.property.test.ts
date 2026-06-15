import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 25: Quota never exceeded under concurrency
// Feature: super-admin-platform, Property 26: Quotas never block reads, lowering limit retains data

import {
  claimQuota,
  releaseQuota,
  getEffectiveLimit,
  isReadBlocked,
  assessLimitReduction,
  simulateConcurrentClaims,
  queryQuotaUsage,
} from "../src/lib/store-hooks/quota";

// ─── Generators ────────────────────────────────────────────────────────────────

const usageArb = fc.nat({ max: 1000 });
const limitArb = fc.nat({ max: 1000 });
const requestedArb = fc.integer({ min: 1, max: 100 });
const resourceArb = fc.string({ minLength: 1, maxLength: 20 });

// ─── Property 25: Quota never exceeded under concurrency ────────────────────────

describe("Feature: super-admin-platform, Property 25: Quota never exceeded under concurrency, usage tracks reality", () => {
  describe("claim below limit → allow + increment", () => {
    it("currentUsage + requested <= limit → allowed and newUsage = currentUsage + requested", () => {
      fc.assert(
        fc.property(usageArb, limitArb, requestedArb, (currentUsage, limit, requested) => {
          // Only test the case where the claim should succeed
          fc.pre(currentUsage < limit && currentUsage + requested <= limit);
          const result = claimQuota({ currentUsage, limit, requested });
          expect(result.allowed).toBe(true);
          if (result.allowed) {
            expect(result.newUsage).toBe(currentUsage + requested);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("at or above limit → 403", () => {
    it("currentUsage >= limit → claim rejected with 403", () => {
      fc.assert(
        fc.property(limitArb, requestedArb, (limit, requested) => {
          const currentUsage = limit; // exactly at limit
          const result = claimQuota({ currentUsage, limit, requested });
          expect(result.allowed).toBe(false);
          if (!result.allowed) {
            expect(result.httpStatus).toBe(403);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("currentUsage + requested > limit → claim rejected with 403", () => {
      fc.assert(
        fc.property(usageArb, requestedArb, (currentUsage, requested) => {
          // Set limit so that the claim would exceed it
          const limit = currentUsage + requested - 1;
          fc.pre(limit >= 0 && currentUsage < limit);
          const result = claimQuota({ currentUsage, limit, requested });
          expect(result.allowed).toBe(false);
          if (!result.allowed) {
            expect(result.httpStatus).toBe(403);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("release decrements", () => {
    it("release decrements usage, floored at 0", () => {
      fc.assert(
        fc.property(usageArb, fc.nat({ max: 1000 }), (currentUsage, released) => {
          const result = releaseQuota({ currentUsage, released });
          expect(result.newUsage).toBe(Math.max(0, currentUsage - released));
          expect(result.newUsage).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("no plan → 0 effective limit", () => {
    it("null planQuotaLimits → effective limit is 0 for any resource", () => {
      fc.assert(
        fc.property(resourceArb, (resource) => {
          const limit = getEffectiveLimit(null, resource);
          expect(limit).toBe(0);
        }),
        { numRuns: 100 },
      );
    });

    it("resource not in plan quota limits → effective limit is 0", () => {
      fc.assert(
        fc.property(resourceArb, (resource) => {
          const limits: Record<string, number> = { other_resource: 100 };
          fc.pre(resource !== "other_resource");
          const limit = getEffectiveLimit(limits, resource);
          expect(limit).toBe(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("concurrency invariant", () => {
    it("simulateConcurrentClaims: granted claims never push usage beyond limit", () => {
      fc.assert(
        fc.property(usageArb, limitArb, fc.nat({ max: 200 }), (startingUsage, effectiveLimit, claimCount) => {
          const result = simulateConcurrentClaims(startingUsage, effectiveLimit, claimCount);
          const flooredUsage = Math.max(0, Math.floor(startingUsage));
          const flooredLimit = Math.max(0, Math.floor(effectiveLimit));
          // finalUsage = startingUsage + granted, so it should never exceed limit
          // (unless startingUsage already exceeds limit, in which case granted = 0)
          if (flooredUsage <= flooredLimit) {
            expect(result.finalUsage).toBeLessThanOrEqual(flooredLimit);
          } else {
            // startingUsage already exceeds limit → no grants, usage stays
            expect(result.granted).toBe(0);
            expect(result.finalUsage).toBe(flooredUsage);
          }
          expect(result.granted + result.rejected).toBe(Math.max(0, Math.floor(claimCount)));
        }),
        { numRuns: 100 },
      );
    });
  });
});

// ─── Property 26: Quotas never block reads, lowering limit retains data ─────────

describe("Feature: super-admin-platform, Property 26: Quotas never block reads, lowering limit retains data", () => {
  describe("reads are never blocked", () => {
    it("isReadBlocked always returns false regardless of usage or limit", () => {
      fc.assert(
        fc.property(usageArb, limitArb, (currentUsage, limit) => {
          const result = isReadBlocked(currentUsage, limit);
          expect(result).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it("even with usage far exceeding limit, reads are not blocked", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1000, max: 100000 }), fc.nat({ max: 10 }), (highUsage, lowLimit) => {
          const result = isReadBlocked(highUsage, lowLimit);
          expect(result).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("lowering limit retains data", () => {
    it("assessLimitReduction always returns dataRetained: true", () => {
      fc.assert(
        fc.property(usageArb, limitArb, (currentUsage, newLimit) => {
          const result = assessLimitReduction(currentUsage, newLimit);
          expect(result.dataRetained).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("when usage >= new limit, creates are blocked but data retained", () => {
      fc.assert(
        fc.property(fc.integer({ min: 5, max: 1000 }), (currentUsage) => {
          const newLimit = currentUsage - 1; // lower than current usage
          fc.pre(newLimit >= 0);
          const result = assessLimitReduction(currentUsage, newLimit);
          expect(result.dataRetained).toBe(true);
          expect(result.createsBlocked).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("when usage < new limit, creates are not blocked", () => {
      fc.assert(
        fc.property(usageArb, (currentUsage) => {
          const newLimit = currentUsage + 10; // higher than current usage
          const result = assessLimitReduction(currentUsage, newLimit);
          expect(result.dataRetained).toBe(true);
          expect(result.createsBlocked).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("queryQuotaUsage returns non-negative integers", () => {
    it("both limit and usage are non-negative integers", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -100, max: 1000 }),
          fc.integer({ min: -100, max: 1000 }),
          (currentUsage, effectiveLimit) => {
            const result = queryQuotaUsage(currentUsage, effectiveLimit);
            expect(result.limit).toBeGreaterThanOrEqual(0);
            expect(result.usage).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(result.limit)).toBe(true);
            expect(Number.isInteger(result.usage)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
