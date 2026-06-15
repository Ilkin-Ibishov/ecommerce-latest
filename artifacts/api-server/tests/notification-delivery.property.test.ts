import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 29: Multi-channel delivery, preferences, retries, in-app preservation

import {
  planDeliveryChannels,
  shouldRetryEmailSimple,
  canAttemptEmail,
  MAX_EMAIL_RETRIES,
} from "../src/lib/notifications/delivery";

// ─── Generators ────────────────────────────────────────────────────────────────

const preferenceArb = fc.record({
  channel: fc.constantFrom("email", "in_app", "sms"),
  enabled: fc.boolean(),
});

const preferencesArb = fc.array(preferenceArb, { minLength: 0, maxLength: 5 });

// ─── Property 29: Multi-channel delivery, preferences, retries, in-app preservation ──

describe("Feature: super-admin-platform, Property 29: Multi-channel delivery, preferences, retries, in-app preservation", () => {
  describe("multichannel → both channels", () => {
    it("multichannel=true with no suppression → plan includes both in_app and email", () => {
      fc.assert(
        fc.property(fc.boolean(), (mandatory) => {
          const channels = planDeliveryChannels({
            multichannel: true,
            mandatory,
            preferences: [], // no preferences = no suppression
          });
          expect(channels).toContain("in_app");
          expect(channels).toContain("email");
        }),
        { numRuns: 100 },
      );
    });

    it("multichannel=false → only in_app regardless of preferences", () => {
      fc.assert(
        fc.property(fc.boolean(), preferencesArb, (mandatory, preferences) => {
          const channels = planDeliveryChannels({
            multichannel: false,
            mandatory,
            preferences,
          });
          expect(channels).toContain("in_app");
          expect(channels).not.toContain("email");
          expect(channels.length).toBe(1);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("mandatory ignores suppression", () => {
    it("mandatory=true with email preference disabled → email still included", () => {
      fc.assert(
        fc.property(fc.constant(true), (mandatory) => {
          const channels = planDeliveryChannels({
            multichannel: true,
            mandatory,
            preferences: [{ channel: "email", enabled: false }],
          });
          expect(channels).toContain("email");
          expect(channels).toContain("in_app");
        }),
        { numRuns: 100 },
      );
    });

    it("mandatory=false with email preference disabled → email suppressed", () => {
      const channels = planDeliveryChannels({
        multichannel: true,
        mandatory: false,
        preferences: [{ channel: "email", enabled: false }],
      });
      expect(channels).toContain("in_app");
      expect(channels).not.toContain("email");
    });
  });

  describe("max 3 retries", () => {
    it("shouldRetryEmailSimple: attemptNumber <= maxRetries → true (can retry)", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: MAX_EMAIL_RETRIES }),
          (attemptNumber) => {
            const result = shouldRetryEmailSimple({
              attemptNumber,
              maxRetries: MAX_EMAIL_RETRIES,
            });
            expect(result).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("shouldRetryEmailSimple: attemptNumber > maxRetries → false (exhausted)", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: MAX_EMAIL_RETRIES + 1, max: MAX_EMAIL_RETRIES + 100 }),
          (attemptNumber) => {
            const result = shouldRetryEmailSimple({
              attemptNumber,
              maxRetries: MAX_EMAIL_RETRIES,
            });
            expect(result).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("MAX_EMAIL_RETRIES is exactly 3", () => {
      expect(MAX_EMAIL_RETRIES).toBe(3);
    });
  });

  describe("missing email → no attempt", () => {
    it("null email → canAttempt: false", () => {
      const result = canAttemptEmail(null);
      expect(result.canAttempt).toBe(false);
      if (!result.canAttempt) {
        expect(result.error).toContain("missing");
      }
    });

    it("empty/whitespace email → canAttempt: false", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("", "   ", "\t", "\n"),
          (email) => {
            const result = canAttemptEmail(email);
            expect(result.canAttempt).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("malformed email (no @ or no domain) → canAttempt: false", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes("@") || !s.includes(".")),
          (email) => {
            const result = canAttemptEmail(email);
            // A string without @ and . is malformed
            if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
              expect(result.canAttempt).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("valid email format → canAttempt: true", () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-z0-9]+$/.test(s)),
            fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-z0-9]+$/.test(s)),
            fc.constantFrom("com", "org", "net", "io"),
          ).map(([user, domain, tld]) => `${user}@${domain}.${tld}`),
          (email) => {
            const result = canAttemptEmail(email);
            expect(result).toEqual({ canAttempt: true });
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("in-app always preserved", () => {
    it("in_app is always the first channel in any plan", () => {
      fc.assert(
        fc.property(fc.boolean(), fc.boolean(), preferencesArb, (multichannel, mandatory, preferences) => {
          const channels = planDeliveryChannels({ multichannel, mandatory, preferences });
          expect(channels[0]).toBe("in_app");
          expect(channels).toContain("in_app");
        }),
        { numRuns: 100 },
      );
    });
  });
});
