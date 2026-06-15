import { describe, it, expect } from "vitest";
import {
  authorizeSuperAdmin,
  satisfiesStoreAdminTier,
  type SuperAdminCredential,
} from "../src/lib/platform/authorize";

/**
 * Unit tests for authorizeSuperAdmin — the pure authorization decision function.
 * Feature: super-admin-platform
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */

describe("authorizeSuperAdmin", () => {
  // R1.6: valid credential → grant
  it("grants when credential is present, super_admin tier, unexpired, and not revoked", () => {
    const credential: SuperAdminCredential = {
      present: true,
      tier: "super_admin",
      expired: false,
      revoked: false,
    };
    const result = authorizeSuperAdmin(credential);
    expect(result.granted).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // R1.3: missing credential → deny
  it("denies when credential is not present", () => {
    const credential: SuperAdminCredential = {
      present: false,
      tier: "super_admin",
      expired: false,
      revoked: false,
    };
    const result = authorizeSuperAdmin(credential);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("credential_missing");
  });

  // R1.5: wrong tier → deny
  it("denies when tier is store_admin", () => {
    const credential: SuperAdminCredential = {
      present: true,
      tier: "store_admin",
      expired: false,
      revoked: false,
    };
    const result = authorizeSuperAdmin(credential);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("insufficient_tier");
  });

  it("denies when tier is customer", () => {
    const credential: SuperAdminCredential = {
      present: true,
      tier: "customer",
      expired: false,
      revoked: false,
    };
    const result = authorizeSuperAdmin(credential);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("insufficient_tier");
  });

  it("denies when tier is null", () => {
    const credential: SuperAdminCredential = {
      present: true,
      tier: null,
      expired: false,
      revoked: false,
    };
    const result = authorizeSuperAdmin(credential);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("insufficient_tier");
  });

  // R1.4: expired → deny
  it("denies when credential is expired", () => {
    const credential: SuperAdminCredential = {
      present: true,
      tier: "super_admin",
      expired: true,
      revoked: false,
    };
    const result = authorizeSuperAdmin(credential);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("credential_expired");
  });

  // R1.4: revoked → deny
  it("denies when credential is revoked", () => {
    const credential: SuperAdminCredential = {
      present: true,
      tier: "super_admin",
      expired: false,
      revoked: true,
    };
    const result = authorizeSuperAdmin(credential);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("credential_revoked");
  });

  // Both expired and revoked
  it("denies with expired reason when both expired and revoked (expired checked first)", () => {
    const credential: SuperAdminCredential = {
      present: true,
      tier: "super_admin",
      expired: true,
      revoked: true,
    };
    const result = authorizeSuperAdmin(credential);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("credential_expired");
  });

  // Not present overrides all other fields
  it("denies with credential_missing even if tier/expired/revoked are all favorable", () => {
    const credential: SuperAdminCredential = {
      present: false,
      tier: "super_admin",
      expired: false,
      revoked: false,
    };
    const result = authorizeSuperAdmin(credential);
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("credential_missing");
  });
});

describe("satisfiesStoreAdminTier", () => {
  // R1.8: Super_Admin satisfies store_admin-tier checks
  it("returns true for a granted decision (super_admin satisfies store_admin tier)", () => {
    expect(satisfiesStoreAdminTier({ granted: true })).toBe(true);
  });

  it("returns false for a denied decision", () => {
    expect(satisfiesStoreAdminTier({ granted: false, reason: "credential_missing" })).toBe(false);
  });
});
