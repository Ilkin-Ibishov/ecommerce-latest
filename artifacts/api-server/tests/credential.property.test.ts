// Feature: super-admin-platform, Property 6: A Store exposes only its own aggregates and rejects foreign or missing credentials
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { verifyStoreCredential } from "../src/lib/store-hooks/credential";

/**
 * Property 6: A Store exposes only its own aggregates and rejects foreign or missing credentials
 *
 * **Validates: Requirements 9.3, 9.4, 9.5, 9.6**
 *
 * For any request to a Store's Control_Plane-facing endpoint, the Store grants it only when
 * the bearer Per_Store_Credential matches that Store's own secret (constant-time compare) and
 * the claimed Store id is that Store:
 *   - matching id + correct bearer        → grant (valid=true)
 *   - foreign id (id !== expectedStoreId) → 403, no data (R9.3)
 *   - missing bearer (or missing id)      → 401, auth-required, no data (R9.6)
 *   - wrong bearer (id matches)           → 403, no data (R9.3/R9.4)
 * Every failure path returns no store data — the verifier yields only a decision object.
 */

// ─── Generators ──────────────────────────────────────────────────────────────────

/** Non-empty string for store ids and secrets. */
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 120 });

/** Missing/empty header value (undefined or empty string). */
const missingArb = fc.constantFrom<string | undefined>(undefined, "");

/**
 * A failure result must never carry store data — it is exactly a denial decision:
 * { valid: false, httpStatus, error } and nothing more.
 */
function expectDenialWithNoData(result: ReturnType<typeof verifyStoreCredential>) {
  expect(result.valid).toBe(false);
  if (result.valid === false) {
    // Only the three decision keys are present — no leaked store data.
    expect(Object.keys(result).sort()).toEqual(["error", "httpStatus", "valid"]);
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeGreaterThan(0);
  }
}

// ─── Property Tests ────────────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 6: A Store exposes only its own aggregates and rejects foreign or missing credentials", () => {
  describe("matching id + correct bearer → grant", () => {
    /** **Validates: Requirements 9.4** */
    it("grants access when the claimed store id and bearer secret both match this Store's own", () => {
      fc.assert(
        fc.property(nonEmptyStringArb, nonEmptyStringArb, (storeId, secret) => {
          const result = verifyStoreCredential({
            headerStoreId: storeId,
            bearerToken: secret,
            expectedStoreId: storeId,
            expectedSecret: secret,
          });
          expect(result).toEqual({ valid: true });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("foreign id → 403 with no data", () => {
    /** **Validates: Requirements 9.3, 9.4** */
    it("rejects a credential whose claimed store id is not this Store, even with the correct secret", () => {
      fc.assert(
        fc.property(
          nonEmptyStringArb,
          nonEmptyStringArb,
          nonEmptyStringArb,
          (headerStoreId, expectedStoreId, secret) => {
            // A genuinely foreign store id (different from this Store's id).
            fc.pre(headerStoreId !== expectedStoreId);

            const result = verifyStoreCredential({
              headerStoreId,
              bearerToken: secret,
              expectedStoreId,
              expectedSecret: secret,
            });

            expect(result).toMatchObject({ valid: false, httpStatus: 403 });
            expectDenialWithNoData(result);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("missing bearer → 401 with no data", () => {
    /** **Validates: Requirements 9.6** */
    it("rejects with an authentication-required error when the bearer token is missing/empty", () => {
      fc.assert(
        fc.property(
          nonEmptyStringArb,
          missingArb,
          nonEmptyStringArb,
          (storeId, bearerToken, secret) => {
            const result = verifyStoreCredential({
              headerStoreId: storeId,
              bearerToken,
              expectedStoreId: storeId,
              expectedSecret: secret,
            });

            expect(result).toMatchObject({ valid: false, httpStatus: 401 });
            expectDenialWithNoData(result);
          },
        ),
        { numRuns: 100 },
      );
    });

    /** **Validates: Requirements 9.6** — a missing store-id header is likewise unauthenticated. */
    it("rejects with 401 when the claimed store id header is missing/empty", () => {
      fc.assert(
        fc.property(
          missingArb,
          nonEmptyStringArb,
          nonEmptyStringArb,
          nonEmptyStringArb,
          (headerStoreId, bearerToken, expectedStoreId, expectedSecret) => {
            const result = verifyStoreCredential({
              headerStoreId,
              bearerToken,
              expectedStoreId,
              expectedSecret,
            });

            expect(result).toMatchObject({ valid: false, httpStatus: 401 });
            expectDenialWithNoData(result);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("wrong bearer → 403 with no data", () => {
    /** **Validates: Requirements 9.3** */
    it("rejects when the store id matches but the bearer secret is wrong", () => {
      fc.assert(
        fc.property(
          nonEmptyStringArb,
          nonEmptyStringArb,
          nonEmptyStringArb,
          (storeId, bearerToken, expectedSecret) => {
            // Same store, but a non-matching secret.
            fc.pre(bearerToken !== expectedSecret);

            const result = verifyStoreCredential({
              headerStoreId: storeId,
              bearerToken,
              expectedStoreId: storeId,
              expectedSecret,
            });

            expect(result).toMatchObject({ valid: false, httpStatus: 403 });
            expectDenialWithNoData(result);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("every failure path returns no data (random header combinations)", () => {
    /** **Validates: Requirements 9.3, 9.4, 9.5, 9.6** */
    it("grants iff id+secret both match and present; otherwise denies with the correct status and no data", () => {
      // Header values may be present, empty, or undefined — the full input space.
      const maybeHeaderArb = fc.oneof(nonEmptyStringArb, fc.constant(""), fc.constant(undefined as string | undefined));

      fc.assert(
        fc.property(
          maybeHeaderArb,
          maybeHeaderArb,
          nonEmptyStringArb,
          nonEmptyStringArb,
          (headerStoreId, bearerToken, expectedStoreId, expectedSecret) => {
            const result = verifyStoreCredential({
              headerStoreId,
              bearerToken,
              expectedStoreId,
              expectedSecret,
            });

            const idPresent = headerStoreId != null && headerStoreId !== "";
            const tokenPresent = bearerToken != null && bearerToken !== "";
            const idMatch = headerStoreId === expectedStoreId;
            const secretMatch = bearerToken === expectedSecret;

            if (!idPresent || !tokenPresent) {
              // Authentication required → 401, no data.
              expect(result).toMatchObject({ valid: false, httpStatus: 401 });
              expectDenialWithNoData(result);
            } else if (!idMatch || !secretMatch) {
              // Foreign or wrong credential → 403, no data.
              expect(result).toMatchObject({ valid: false, httpStatus: 403 });
              expectDenialWithNoData(result);
            } else {
              // Only path that grants access.
              expect(result).toEqual({ valid: true });
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
