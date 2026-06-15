/**
 * Unit tests for the Per_Store_Credential verifier.
 *
 * Feature: super-admin-platform
 * Requirements: 9.3, 9.6
 */
import { describe, it, expect } from "vitest";
import {
  verifyStoreCredential,
  type CredentialVerifyInput,
} from "../src/lib/store-hooks/credential";

describe("verifyStoreCredential", () => {
  const validInput: CredentialVerifyInput = {
    headerStoreId: "store-abc-123",
    bearerToken: "secret-token-xyz",
    expectedStoreId: "store-abc-123",
    expectedSecret: "secret-token-xyz",
  };

  // --- Step 1: Missing or empty headerStoreId → 401 ---

  it("returns 401 when headerStoreId is undefined", () => {
    const result = verifyStoreCredential({
      ...validInput,
      headerStoreId: undefined,
    });
    expect(result).toEqual({
      valid: false,
      httpStatus: 401,
      error: "authentication required",
    });
  });

  it("returns 401 when headerStoreId is empty string", () => {
    const result = verifyStoreCredential({
      ...validInput,
      headerStoreId: "",
    });
    expect(result).toEqual({
      valid: false,
      httpStatus: 401,
      error: "authentication required",
    });
  });

  // --- Step 2: Missing or empty bearerToken → 401 ---

  it("returns 401 when bearerToken is undefined", () => {
    const result = verifyStoreCredential({
      ...validInput,
      bearerToken: undefined,
    });
    expect(result).toEqual({
      valid: false,
      httpStatus: 401,
      error: "authentication required",
    });
  });

  it("returns 401 when bearerToken is empty string", () => {
    const result = verifyStoreCredential({
      ...validInput,
      bearerToken: "",
    });
    expect(result).toEqual({
      valid: false,
      httpStatus: 401,
      error: "authentication required",
    });
  });

  // --- Step 3: Foreign credential (store id mismatch) → 403 ---

  it("returns 403 when headerStoreId does not match expectedStoreId", () => {
    const result = verifyStoreCredential({
      ...validInput,
      headerStoreId: "other-store-456",
    });
    expect(result).toEqual({
      valid: false,
      httpStatus: 403,
      error: "Forbidden",
    });
  });

  // --- Step 4: Bearer mismatch (constant-time compare) → 403 ---

  it("returns 403 when bearerToken does not match expectedSecret (same length)", () => {
    const result = verifyStoreCredential({
      ...validInput,
      bearerToken: "wrong-token-xyz!",
    });
    expect(result).toEqual({
      valid: false,
      httpStatus: 403,
      error: "Forbidden",
    });
  });

  it("returns 403 when bearerToken does not match expectedSecret (different length)", () => {
    const result = verifyStoreCredential({
      ...validInput,
      bearerToken: "short",
    });
    expect(result).toEqual({
      valid: false,
      httpStatus: 403,
      error: "Forbidden",
    });
  });

  it("returns 403 when bearerToken is longer than expectedSecret", () => {
    const result = verifyStoreCredential({
      ...validInput,
      bearerToken: "secret-token-xyz-with-extra-data-appended",
    });
    expect(result).toEqual({
      valid: false,
      httpStatus: 403,
      error: "Forbidden",
    });
  });

  // --- Step 5: All checks pass → valid ---

  it("returns valid: true when all checks pass", () => {
    const result = verifyStoreCredential(validInput);
    expect(result).toEqual({ valid: true });
  });

  // --- Priority ordering: step 1 checked before step 3 ---

  it("returns 401 (not 403) when both storeId is missing and bearer mismatches", () => {
    const result = verifyStoreCredential({
      ...validInput,
      headerStoreId: undefined,
      bearerToken: "wrong-secret",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.httpStatus).toBe(401);
    }
  });

  // --- Priority ordering: step 2 checked before step 3 ---

  it("returns 401 (not 403) when storeId matches but bearer is missing", () => {
    const result = verifyStoreCredential({
      ...validInput,
      bearerToken: undefined,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.httpStatus).toBe(401);
    }
  });
});
