import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  resolveNotificationTargets,
  type TargetingInput,
  type TargetingResult,
} from "../src/lib/notifications/target";

/**
 * Notification Targeting Property Tests
 * Feature: super-admin-platform
 *
 * Property 9: Platform-message targeting addresses exactly the intended Stores.
 * Property 10: Platform-message content and target validation is all-or-nothing.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6, 8.8**
 *
 * resolveNotificationTargets is pure:
 *  - single (1 id, not disabled) / set (2–1000 registered ids) / broadcast
 *    (= all non-`disabled` Stores) → exact resolved target set.
 *  - content empty / whitespace-only / >5000 chars → 400, no notification.
 *  - any target id absent from the registry → whole request 404, nothing created.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** An invalid (rejected) result must never expose a resolved target set — i.e. nothing created. */
function expectNothingCreated(result: TargetingResult): void {
  expect(result.valid).toBe(false);
  expect(result).not.toHaveProperty("resolvedTargetIds");
}

function asSet(ids: string[]): string[] {
  return [...ids].sort();
}

// ─── Generators ────────────────────────────────────────────────────────────────

/** Content that is valid: non-empty after trimming, and ≤5000 characters. */
const validContentArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0 && s.length <= 5000);

/** Content that must be rejected with 400: empty, whitespace-only, or >5000 chars. */
const invalidContentArb = fc.oneof(
  fc.constant(""),
  fc
    .array(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), {
      minLength: 1,
      maxLength: 20,
    })
    .map((chars) => chars.join("")),
  fc.integer({ min: 5001, max: 5200 }).map((n) => "x".repeat(n)),
);

/** A registry of unique store identifiers. */
function registryArb(minLength: number, maxLength = 30) {
  return fc.uniqueArray(fc.uuid(), { minLength, maxLength });
}

/** A store id guaranteed to be absent from the given registry. */
function absentIdArb(registry: string[]) {
  const registered = new Set(registry);
  return fc.uuid().filter((id) => !registered.has(id));
}

// ─── Property 9 case generators (valid content + registered targets) ────────────

/** Single target at a non-disabled registered Store. */
const singleCaseArb = registryArb(1).chain((registry) =>
  fc
    .record({
      targetIdx: fc.nat({ max: registry.length - 1 }),
      content: validContentArb,
    })
    .chain(({ targetIdx, content }) => {
      const targetId = registry[targetIdx];
      // Disabled stores are drawn from everything EXCEPT the chosen target,
      // guaranteeing the single target is not disabled (R8.1).
      const others = registry.filter((_, i) => i !== targetIdx);
      return fc.subarray(others).map((disabled) => ({
        input: {
          content,
          targetStoreIds: [targetId],
          registeredStoreIds: registry,
          disabledStoreIds: disabled,
        } as TargetingInput,
        expectedScope: "single" as const,
        expected: [targetId],
      }));
    }),
);

/** Set target of 2–1000 registered Stores (may include disabled ones). */
const setCaseArb = registryArb(2).chain((registry) => {
  const maxSet = Math.min(1000, registry.length);
  return fc
    .record({
      subset: fc.subarray(registry, { minLength: 2, maxLength: maxSet }),
      disabled: fc.subarray(registry),
      content: validContentArb,
    })
    .map(({ subset, disabled, content }) => ({
      input: {
        content,
        targetStoreIds: subset,
        registeredStoreIds: registry,
        disabledStoreIds: disabled,
      } as TargetingInput,
      expectedScope: "set" as const,
      // Set targeting includes disabled members; only broadcast excludes them.
      expected: subset,
    }));
});

/** Broadcast target = all registered Stores whose status is not disabled. */
const broadcastCaseArb = registryArb(0).chain((registry) =>
  fc
    .record({
      disabled: fc.subarray(registry),
      content: validContentArb,
    })
    .map(({ disabled, content }) => {
      const disabledSet = new Set(disabled);
      return {
        input: {
          content,
          targetStoreIds: "broadcast" as const,
          registeredStoreIds: registry,
          disabledStoreIds: disabled,
        } as TargetingInput,
        expectedScope: "broadcast" as const,
        expected: registry.filter((id) => !disabledSet.has(id)),
      };
    }),
);

// ─── Property 9: targeting addresses exactly the intended Stores ────────────────

// Feature: super-admin-platform, Property 9: Platform-message targeting addresses exactly the intended Stores
describe("Feature: super-admin-platform, Property 9: Platform-message targeting addresses exactly the intended Stores", () => {
  /**
   * **Validates: Requirements 8.1**
   * Single target at a non-disabled registered Store resolves to exactly that one Store.
   */
  it("single target → resolves to exactly the one intended (non-disabled) Store", () => {
    fc.assert(
      fc.property(singleCaseArb, ({ input, expected }) => {
        const result = resolveNotificationTargets(input);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.scope).toBe("single");
          expect(asSet(result.resolvedTargetIds)).toEqual(asSet(expected));
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.2**
   * A set of 2–1000 registered Stores resolves to exactly that set (disabled included).
   */
  it("set target → resolves to exactly the intended set of Stores", () => {
    fc.assert(
      fc.property(setCaseArb, ({ input, expected }) => {
        const result = resolveNotificationTargets(input);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.scope).toBe("set");
          expect(asSet(result.resolvedTargetIds)).toEqual(asSet(expected));
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.3, 8.8**
   * Broadcast resolves to every registered Store whose status is not disabled,
   * and never includes a disabled Store.
   */
  it("broadcast → resolves to exactly all non-disabled registered Stores", () => {
    fc.assert(
      fc.property(broadcastCaseArb, ({ input, expected }) => {
        const result = resolveNotificationTargets(input);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.scope).toBe("broadcast");
          expect(asSet(result.resolvedTargetIds)).toEqual(asSet(expected));
          // No disabled store ever appears in a broadcast target set (R8.3).
          const disabledSet = new Set(input.disabledStoreIds);
          for (const id of result.resolvedTargetIds) {
            expect(disabledSet.has(id)).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.8**
   * Across all targeting modes, every resolved target is a registered Store and
   * no Store outside the intended set is addressed.
   */
  it("resolved targets are always a subset of the registry and contain no unintended Store", () => {
    fc.assert(
      fc.property(
        fc.oneof(singleCaseArb, setCaseArb, broadcastCaseArb),
        ({ input, expected }) => {
          const result = resolveNotificationTargets(input);
          expect(result.valid).toBe(true);
          if (result.valid) {
            const registeredSet = new Set(input.registeredStoreIds);
            const expectedSet = new Set(expected);
            for (const id of result.resolvedTargetIds) {
              expect(registeredSet.has(id)).toBe(true);
              expect(expectedSet.has(id)).toBe(true);
            }
            // Exactly the intended set: no intended Store is dropped either.
            expect(result.resolvedTargetIds.length).toBe(expected.length);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10 case generators ────────────────────────────────────────────────

/** Any otherwise-valid registered targeting spec (single / set / broadcast). */
function registeredTargetArb(registry: string[]) {
  const maxSet = Math.min(1000, registry.length);
  const options: fc.Arbitrary<string[] | "broadcast">[] = [
    fc.constant("broadcast" as const),
    fc.constantFrom(...registry).map((id) => [id]),
  ];
  if (registry.length >= 2) {
    options.push(fc.subarray(registry, { minLength: 2, maxLength: maxSet }));
  }
  return fc.oneof(...options);
}

/** Invalid content paired with otherwise-valid registered targets. */
const invalidContentCaseArb = registryArb(1).chain((registry) =>
  fc
    .record({
      target: registeredTargetArb(registry),
      disabled: fc.subarray(registry),
      content: invalidContentArb,
    })
    .map(({ target, disabled, content }) => ({
      input: {
        content,
        targetStoreIds: target,
        registeredStoreIds: registry,
        disabledStoreIds: disabled,
      } as TargetingInput,
    })),
);

/** Valid content but a target set containing at least one id absent from the registry. */
const absentTargetCaseArb = registryArb(1).chain((registry) =>
  absentIdArb(registry).chain((absentId) => {
    const singleAbsent = fc.constant([absentId]);
    const maxRegisteredInSet = Math.min(999, registry.length);
    const setWithAbsent = fc
      .subarray(registry, { minLength: 0, maxLength: maxRegisteredInSet })
      .map((sub) => [...sub, absentId]);
    return fc
      .record({
        target: fc.oneof(singleAbsent, setWithAbsent),
        disabled: fc.subarray(registry),
        content: validContentArb,
      })
      .map(({ target, disabled, content }) => ({
        input: {
          content,
          targetStoreIds: target,
          registeredStoreIds: registry,
          disabledStoreIds: disabled,
        } as TargetingInput,
        absentId,
      }));
  }),
);

// ─── Property 10: content and target validation is all-or-nothing ───────────────

// Feature: super-admin-platform, Property 10: Platform-message content and target validation is all-or-nothing
describe("Feature: super-admin-platform, Property 10: Platform-message content and target validation is all-or-nothing", () => {
  /**
   * **Validates: Requirements 8.5**
   * Empty, whitespace-only, or >5000-char content is rejected with HTTP 400 and
   * no Notification is created — regardless of how the targets are specified.
   */
  it("invalid content → 400 and nothing created", () => {
    fc.assert(
      fc.property(invalidContentCaseArb, ({ input }) => {
        const result = resolveNotificationTargets(input);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.httpStatus).toBe(400);
        }
        expectNothingCreated(result);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.6**
   * Any target id absent from the registry rejects the whole request with HTTP 404
   * and creates no Notifications (all-or-nothing).
   */
  it("any absent target id → whole request 404 and nothing created", () => {
    fc.assert(
      fc.property(absentTargetCaseArb, ({ input }) => {
        const result = resolveNotificationTargets(input);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.httpStatus).toBe(404);
        }
        expectNothingCreated(result);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.5, 8.6**
   * Content validation takes precedence and the outcome is binary: a rejected
   * request never yields a partial/empty resolved target set (no notification at all).
   */
  it("invalid content with an absent target id → still 400 (content checked first), nothing created", () => {
    fc.assert(
      fc.property(
        registryArb(1),
        invalidContentArb,
        (registry, content) => {
          const absentId = `${registry[0]}-absent-marker`;
          const input: TargetingInput = {
            content,
            targetStoreIds: [registry[0], absentId],
            registeredStoreIds: registry,
            disabledStoreIds: [],
          };
          const result = resolveNotificationTargets(input);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.httpStatus).toBe(400);
          }
          expectNothingCreated(result);
        },
      ),
      { numRuns: 100 },
    );
  });
});
