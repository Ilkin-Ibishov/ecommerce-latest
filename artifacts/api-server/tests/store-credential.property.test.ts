// Feature: super-admin-platform, Property 6: A Store exposes only its own aggregates and rejects foreign or missing credentials
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { verifyStoreCredential } from "../src/lib/store-hooks/credential";

/**
 * Property 6: A Store exposes only its own aggregates and rejects foreign or missing credentials
 *
 * **Validates: Requirements 9.3, 9.4, 9.5, 9.6**
 *
 * The Per_Store_Credential verifier must:
 * - Return valid=true iff headerStoreId matches expectedStoreId AND bearerToken matches expectedSecret AND both are non-empty
 * - Return httpStatus 401 when headerStoreId or bearerToken is missing/empty
 * - Return httpStatus 403 when headerStoreId !== expectedStoreId (foreign credential)
 * - Return httpStatus 403 when bearerToken !== expectedSecret (with matching storeId)
 */

// ─── Generators ────────────────────────────────────────────────────────────────

/** Non-empty string for store ids and secrets */
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 100 }).filter(
  (s) => s.length > 0
);

/** Generate credential inputs with all valid matching values */
const validCredentialArb = nonEmptyStringArb.chain((storeId) =>
  nonEmptyStringArb.map((secret) => ({
    headerStoreId: storeId,
    bearerToken: secret,
    expectedStoreId: storeId,
    expectedSecret: secret,
  }))
);

/** Generate missing/empty headerStoreId cases */
const missingStoreIdArb = fc.oneof(
  fc.constant(undefined as string | undefined),
  fc.constant("" as string)
);

/** Generate missing/empty bearerToken cases */
const missingTokenArb = fc.oneof(
  fc.constant(undefined as string | undefined),
  fc.constant("" as string)
);

// ─── Property Tests ─────────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 6: A Store exposes only its own aggregates and rejects foreign or missing credentials", () => {
  describe("valid credentials → valid=true", () => {
    it("returns valid=true when headerStoreId matches expectedStoreId AND bearerToken matches expectedSecret", () => {
      fc.assert(
        fc.property(validCredentialArb, (input) => {
          const result = verifyStoreCredential(input);
          expect(result).toEqual({ valid: true });
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("missing/empty headerStoreId → httpStatus 401", () => {
    it("returns 401 when headerStoreId is missing or empty", () => {
      fc.assert(
        fc.property(
          missingStoreIdArb,
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
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("missing/empty bearerToken → httpStatus 401", () => {
    it("returns 401 when bearerToken is missing or empty", () => {
      fc.assert(
        fc.property(
          nonEmptyStringArb,
          missingTokenArb,
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
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("foreign credential (headerStoreId !== expectedStoreId) → httpStatus 403", () => {
    it("returns 403 when store ids do not match", () => {
      fc.assert(
        fc.property(
          nonEmptyStringArb,
          nonEmptyStringArb,
          nonEmptyStringArb,
          (headerStoreId, expectedStoreId, secret) => {
            // Ensure store IDs are different
            fc.pre(headerStoreId !== expectedStoreId);

            const result = verifyStoreCredential({
              headerStoreId,
              bearerToken: secret,
              expectedStoreId,
              expectedSecret: secret,
            });
            expect(result).toMatchObject({ valid: false, httpStatus: 403 });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("wrong secret (matching storeId, bearerToken !== expectedSecret) → httpStatus 403", () => {
    it("returns 403 when bearer token does not match expected secret", () => {
      fc.assert(
        fc.property(
          nonEmptyStringArb,
          nonEmptyStringArb,
          nonEmptyStringArb,
          (storeId, bearerToken, expectedSecret) => {
            // Ensure tokens are different
            fc.pre(bearerToken !== expectedSecret);

            const result = verifyStoreCredential({
              headerStoreId: storeId,
              bearerToken,
              expectedStoreId: storeId,
              expectedSecret,
            });
            expect(result).toMatchObject({ valid: false, httpStatus: 403 });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("comprehensive: valid iff all conditions met", () => {
    it("valid=true iff headerStoreId===expectedStoreId AND bearerToken===expectedSecret AND both non-empty", () => {
      fc.assert(
        fc.property(
          fc.oneof(nonEmptyStringArb, fc.constant(""), fc.constant(undefined as string | undefined)),
          fc.oneof(nonEmptyStringArb, fc.constant(""), fc.constant(undefined as string | undefined)),
          nonEmptyStringArb,
          nonEmptyStringArb,
          (headerStoreId, bearerToken, expectedStoreId, expectedSecret) => {
            const result = verifyStoreCredential({
              headerStoreId,
              bearerToken,
              expectedStoreId,
              expectedSecret,
            });

            const headerPresent = headerStoreId != null && headerStoreId !== "";
            const tokenPresent = bearerToken != null && bearerToken !== "";
            const storeIdMatch = headerStoreId === expectedStoreId;
            const secretMatch = bearerToken === expectedSecret;

            if (!headerPresent || !tokenPresent) {
              expect(result).toMatchObject({ valid: false, httpStatus: 401 });
            } else if (!storeIdMatch) {
              expect(result).toMatchObject({ valid: false, httpStatus: 403 });
            } else if (!secretMatch) {
              expect(result).toMatchObject({ valid: false, httpStatus: 403 });
            } else {
              expect(result).toEqual({ valid: true });
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
