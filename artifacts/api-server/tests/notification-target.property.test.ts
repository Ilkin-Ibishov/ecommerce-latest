// Feature: super-admin-platform, Property 9: Platform-message targeting addresses exactly the intended Stores
// Feature: super-admin-platform, Property 10: Platform-message content and target validation is all-or-nothing
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolveNotificationTargets } from "../src/lib/notifications/target";

/**
 * Property 9: Platform-message targeting addresses exactly the intended Stores
 * Property 10: Platform-message content and target validation is all-or-nothing
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6, 8.8**
 *
 * Property 9:
 * - Broadcast targets exactly all non-disabled registered stores
 * - Single target yields exactly that store
 * - Set target yields exactly those stores
 *
 * Property 10:
 * - Empty/whitespace/>5000 content → httpStatus 400, no targets resolved
 * - Any missing store id → httpStatus 404, nothing created
 */

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a store ID */
const storeIdArb = fc.uuid();

/** Generate a non-empty set of unique store IDs */
const storeIdSetArb = (minLength = 1, maxLength = 20) =>
  fc.uniqueArray(storeIdArb, { minLength, maxLength });

/** Generate valid content (non-empty, non-whitespace, ≤5000 chars) */
const validContentArb = fc
  .string({ minLength: 1, maxLength: 5000 })
  .filter((s) => s.trim().length > 0);

/** Generate invalid content: empty, whitespace-only, or >5000 chars */
const invalidContentArb = fc.oneof(
  fc.constant(""),
  fc.constant("   "),
  fc.constant("\t\t\t"),
  fc.constant("\n\n\n"),
  fc.constant("  \t \n  "),
  fc.nat({ max: 30 }).map((n) => " ".repeat(n + 1)),
  fc.string({ minLength: 5001, maxLength: 5100 })
);

// ─── Property 9 Tests ───────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 9: Platform-message targeting addresses exactly the intended Stores", () => {
  describe("broadcast → targets exactly all non-disabled registered stores", () => {
    it("broadcast resolves to all registered stores minus disabled ones", () => {
      fc.assert(
        fc.property(
          validContentArb,
          storeIdSetArb(1, 20),
          (content, registeredStoreIds) => {
            // Randomly split into disabled and non-disabled
            const disabledCount = Math.floor(registeredStoreIds.length / 3);
            const disabledStoreIds = registeredStoreIds.slice(0, disabledCount);
            const expectedTargets = registeredStoreIds.filter(
              (id) => !disabledStoreIds.includes(id)
            );

            const result = resolveNotificationTargets({
              content,
              targetStoreIds: "broadcast",
              registeredStoreIds,
              disabledStoreIds,
            });

            expect(result.valid).toBe(true);
            if (result.valid) {
              expect(result.scope).toBe("broadcast");
              expect(result.resolvedTargetIds.sort()).toEqual(expectedTargets.sort());
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("broadcast with all stores disabled → resolves to empty set (still valid)", () => {
      fc.assert(
        fc.property(
          validContentArb,
          storeIdSetArb(1, 10),
          (content, registeredStoreIds) => {
            const result = resolveNotificationTargets({
              content,
              targetStoreIds: "broadcast",
              registeredStoreIds,
              disabledStoreIds: [...registeredStoreIds],
            });

            expect(result.valid).toBe(true);
            if (result.valid) {
              expect(result.scope).toBe("broadcast");
              expect(result.resolvedTargetIds).toEqual([]);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("single target → targets exactly that store", () => {
    it("single registered non-disabled store → resolves to exactly [that store]", () => {
      fc.assert(
        fc.property(
          validContentArb,
          storeIdSetArb(2, 15),
          fc.nat(),
          (content, registeredStoreIds, indexSeed) => {
            // Pick a store that's not disabled
            const disabledStoreIds = [registeredStoreIds[0]]; // only first is disabled
            const nonDisabled = registeredStoreIds.filter(
              (id) => !disabledStoreIds.includes(id)
            );
            fc.pre(nonDisabled.length > 0);
            const targetId = nonDisabled[indexSeed % nonDisabled.length];

            const result = resolveNotificationTargets({
              content,
              targetStoreIds: [targetId],
              registeredStoreIds,
              disabledStoreIds,
            });

            expect(result.valid).toBe(true);
            if (result.valid) {
              expect(result.scope).toBe("single");
              expect(result.resolvedTargetIds).toEqual([targetId]);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("set target → targets exactly those stores", () => {
    it("set of registered stores → resolves to exactly that set", () => {
      fc.assert(
        fc.property(
          validContentArb,
          storeIdSetArb(5, 20),
          (content, registeredStoreIds) => {
            // Take a subset of 2-4 stores as the target set
            const targetSize = Math.min(
              Math.max(2, Math.floor(registeredStoreIds.length / 2)),
              registeredStoreIds.length
            );
            const targetStoreIds = registeredStoreIds.slice(0, targetSize);
            fc.pre(targetStoreIds.length >= 2);

            const result = resolveNotificationTargets({
              content,
              targetStoreIds,
              registeredStoreIds,
              disabledStoreIds: [],
            });

            expect(result.valid).toBe(true);
            if (result.valid) {
              expect(result.scope).toBe("set");
              expect(result.resolvedTargetIds.sort()).toEqual(targetStoreIds.sort());
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ─── Property 10 Tests ──────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 10: Platform-message content and target validation is all-or-nothing", () => {
  describe("empty/whitespace/>5000 content → httpStatus 400, no targets resolved", () => {
    it("invalid content always returns 400 regardless of valid targets", () => {
      fc.assert(
        fc.property(
          invalidContentArb,
          storeIdSetArb(1, 10),
          (content, registeredStoreIds) => {
            const result = resolveNotificationTargets({
              content,
              targetStoreIds: "broadcast",
              registeredStoreIds,
              disabledStoreIds: [],
            });

            expect(result.valid).toBe(false);
            if (!result.valid) {
              expect(result.httpStatus).toBe(400);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("invalid content with single target also returns 400", () => {
      fc.assert(
        fc.property(
          invalidContentArb,
          storeIdSetArb(1, 10),
          (content, registeredStoreIds) => {
            const result = resolveNotificationTargets({
              content,
              targetStoreIds: [registeredStoreIds[0]],
              registeredStoreIds,
              disabledStoreIds: [],
            });

            expect(result.valid).toBe(false);
            if (!result.valid) {
              expect(result.httpStatus).toBe(400);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("any missing store id → httpStatus 404, nothing created", () => {
    it("a target ID not in registry → 404", () => {
      fc.assert(
        fc.property(
          validContentArb,
          storeIdSetArb(1, 10),
          storeIdArb,
          (content, registeredStoreIds, foreignId) => {
            // Ensure foreignId is not in the registered set
            fc.pre(!registeredStoreIds.includes(foreignId));

            const result = resolveNotificationTargets({
              content,
              targetStoreIds: [foreignId],
              registeredStoreIds,
              disabledStoreIds: [],
            });

            expect(result.valid).toBe(false);
            if (!result.valid) {
              expect(result.httpStatus).toBe(404);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("a set containing at least one missing store → entire request 404", () => {
      fc.assert(
        fc.property(
          validContentArb,
          storeIdSetArb(2, 10),
          storeIdArb,
          (content, registeredStoreIds, foreignId) => {
            fc.pre(!registeredStoreIds.includes(foreignId));

            // Mix registered + one foreign
            const targets = [registeredStoreIds[0], foreignId];

            const result = resolveNotificationTargets({
              content,
              targetStoreIds: targets,
              registeredStoreIds,
              disabledStoreIds: [],
            });

            expect(result.valid).toBe(false);
            if (!result.valid) {
              expect(result.httpStatus).toBe(404);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("empty target array → httpStatus 400", () => {
    it("returns 400 when targetStoreIds is an empty array", () => {
      fc.assert(
        fc.property(
          validContentArb,
          storeIdSetArb(1, 10),
          (content, registeredStoreIds) => {
            const result = resolveNotificationTargets({
              content,
              targetStoreIds: [],
              registeredStoreIds,
              disabledStoreIds: [],
            });

            expect(result.valid).toBe(false);
            if (!result.valid) {
              expect(result.httpStatus).toBe(400);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("single target to a disabled store → 404", () => {
    it("targeting a disabled store as a single target returns 404", () => {
      fc.assert(
        fc.property(
          validContentArb,
          storeIdSetArb(1, 10),
          (content, registeredStoreIds) => {
            const disabledId = registeredStoreIds[0];

            const result = resolveNotificationTargets({
              content,
              targetStoreIds: [disabledId],
              registeredStoreIds,
              disabledStoreIds: [disabledId],
            });

            expect(result.valid).toBe(false);
            if (!result.valid) {
              expect(result.httpStatus).toBe(404);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
