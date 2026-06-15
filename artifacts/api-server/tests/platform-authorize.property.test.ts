import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  authorizeSuperAdmin,
  satisfiesStoreAdminTier,
  type SuperAdminCredential,
  type CredentialTier,
} from "../src/lib/platform/authorize";

// Feature: super-admin-platform, Property 1: Server-side super-admin authorization

/**
 * Property 1: Server-side super-admin authorization
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 8.7**
 *
 * For any request credential (varying presence, tier, expiry, and revocation),
 * the authorization decision SHALL grant access if and only if the credential
 * is present, identifies the Super_Admin tier, is unexpired, and is not revoked;
 * every denied request SHALL leave all target resources unchanged and return a
 * reason, and any valid Super_Admin SHALL also be authorized for Store_Admin-tier
 * operations (satisfiesStoreAdminTier returns true).
 */

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a credential tier (super_admin, store_admin, customer, or null) */
const tierArb: fc.Arbitrary<CredentialTier> = fc.constantFrom(
  "super_admin" as const,
  "store_admin" as const,
  "customer" as const,
  null
);

/** Generate a full SuperAdminCredential with all combinations */
const credentialArb: fc.Arbitrary<SuperAdminCredential> = fc.record({
  present: fc.boolean(),
  tier: tierArb,
  expired: fc.boolean(),
  revoked: fc.boolean(),
});

/** Generate a credential that is specifically valid (granted) */
const validCredentialArb: fc.Arbitrary<SuperAdminCredential> = fc.constant({
  present: true,
  tier: "super_admin" as const,
  expired: false,
  revoked: false,
});

/** Generate a credential that is specifically invalid (denied) — at least one condition violated */
const invalidCredentialArb: fc.Arbitrary<SuperAdminCredential> = credentialArb.filter(
  (c) => !(c.present && c.tier === "super_admin" && !c.expired && !c.revoked)
);

// ─── Property Tests ────────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 1: Server-side super-admin authorization", () => {
  describe("Grant iff all four conditions are met (R1.1, R1.2, R1.6)", () => {
    it("grants access if and only if present=true AND tier=super_admin AND expired=false AND revoked=false", () => {
      fc.assert(
        fc.property(credentialArb, (credential) => {
          const decision = authorizeSuperAdmin(credential);

          const shouldGrant =
            credential.present &&
            credential.tier === "super_admin" &&
            !credential.expired &&
            !credential.revoked;

          expect(decision.granted).toBe(shouldGrant);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Valid Super_Admin also satisfies Store_Admin tier (R1.8)", () => {
    it("when granted, satisfiesStoreAdminTier returns true", () => {
      fc.assert(
        fc.property(validCredentialArb, (credential) => {
          const decision = authorizeSuperAdmin(credential);

          expect(decision.granted).toBe(true);
          expect(satisfiesStoreAdminTier(decision)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Denied requests always return a reason string (R1.3, R1.4, R1.5, R1.7)", () => {
    it("when denied, reason is always a non-empty string (never undefined)", () => {
      fc.assert(
        fc.property(invalidCredentialArb, (credential) => {
          const decision = authorizeSuperAdmin(credential);

          expect(decision.granted).toBe(false);
          expect(typeof decision.reason).toBe("string");
          expect(decision.reason).not.toBe("");
          expect(decision.reason).not.toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Denied decisions never include granted=true (no resource mutation implied) (R1.3, R1.4, R1.5, R8.7)", () => {
    it("when denied, the decision object has granted=false and no grant leak", () => {
      fc.assert(
        fc.property(invalidCredentialArb, (credential) => {
          const decision = authorizeSuperAdmin(credential);

          // The decision must be strictly denied
          expect(decision.granted).toBe(false);
          // Ensure no property on the decision could be mistaken for a grant
          expect(decision).not.toHaveProperty("granted", true);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("satisfiesStoreAdminTier reflects the grant decision (R1.8)", () => {
    it("satisfiesStoreAdminTier is true only when the decision is granted", () => {
      fc.assert(
        fc.property(credentialArb, (credential) => {
          const decision = authorizeSuperAdmin(credential);

          // satisfiesStoreAdminTier should match the granted state exactly
          expect(satisfiesStoreAdminTier(decision)).toBe(decision.granted);
        }),
        { numRuns: 100 },
      );
    });
  });
});
