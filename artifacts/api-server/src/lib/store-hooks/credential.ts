/**
 * Store-side Per_Store_Credential verifier — pure function (no DB, no HTTP).
 *
 * Extracted from the inline verification in `routes/platform/store-feed.ts`
 * as a reusable, testable pure function for Property 6 testing.
 *
 * Feature: super-admin-platform
 * Requirements: 9.3, 9.6
 */

import { timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CredentialVerifyResult =
  | { valid: true }
  | { valid: false; httpStatus: 401 | 403; error: string };

export interface CredentialVerifyInput {
  /** The X-Store-Id header value (may be undefined/empty). */
  headerStoreId: string | undefined;
  /** The bearer token extracted from the Authorization header (may be undefined/empty). */
  bearerToken: string | undefined;
  /** The Store's own configured store id. */
  expectedStoreId: string;
  /** The Store's own configured secret. */
  expectedSecret: string;
}

// ---------------------------------------------------------------------------
// Constant-time string comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of two strings using Node's timingSafeEqual.
 * Handles different-length strings safely: always performs the comparison
 * (against a padded buffer) so timing doesn't leak length information,
 * but returns false for any length mismatch.
 */
function safeCompare(provided: string, expected: string): boolean {
  if (provided.length === 0) return false;
  if (expected.length === 0) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    // Compare against a same-length buffer to avoid leaking length info via timing
    const padded = Buffer.alloc(a.length);
    b.copy(padded, 0, 0, Math.min(b.length, a.length));
    timingSafeEqual(a, padded);
    return false;
  }

  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Credential verification — pure decision
// ---------------------------------------------------------------------------

/**
 * Verify a Per_Store_Credential request.
 *
 * Logic:
 *  1. If headerStoreId is missing or empty → 401 "authentication required"
 *  2. If bearerToken is missing or empty → 401 "authentication required"
 *  3. If headerStoreId !== expectedStoreId → 403 "Forbidden" (foreign credential)
 *  4. Constant-time compare bearerToken vs expectedSecret → mismatch → 403 "Forbidden"
 *  5. All checks pass → { valid: true }
 */
export function verifyStoreCredential(
  input: CredentialVerifyInput,
): CredentialVerifyResult {
  const { headerStoreId, bearerToken, expectedStoreId, expectedSecret } = input;

  // 1. Missing or empty store id header
  if (headerStoreId == null || headerStoreId === "") {
    return { valid: false, httpStatus: 401, error: "authentication required" };
  }

  // 2. Missing or empty bearer token
  if (bearerToken == null || bearerToken === "") {
    return { valid: false, httpStatus: 401, error: "authentication required" };
  }

  // 3. Foreign credential — store id doesn't match this store
  if (headerStoreId !== expectedStoreId) {
    return { valid: false, httpStatus: 403, error: "Forbidden" };
  }

  // 4. Constant-time compare bearer vs expected secret
  if (!safeCompare(bearerToken, expectedSecret)) {
    return { valid: false, httpStatus: 403, error: "Forbidden" };
  }

  // 5. All checks pass
  return { valid: true };
}
