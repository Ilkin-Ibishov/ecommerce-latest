/**
 * Pure authorization decision function for Super_Admin access to the Control_Plane.
 *
 * This function evaluates a credential descriptor and returns a grant/deny decision.
 * It is intentionally pure (no DB calls, no side effects) so it can be tested
 * exhaustively via property-based testing.
 *
 * @design-invariant This function never grants direct access to any Store's database.
 * Store isolation is enforced architecturally by the platform route structure:
 * all Control_Plane routes use only `getControlPlaneSupabase()` and never a store client.
 * Even when granted, the caller operates exclusively within the Control_Plane_Database scope.
 *
 * @design-invariant A granted Super_Admin credential also satisfies Store_Admin-tier
 * checks conceptually (R1.8): the Super_Admin tier is strictly superior to Store_Admin.
 * However, this function itself does not grant Store_Admin access — that remains
 * scoped to each Store's own `requireAdmin` middleware operating against its own database.
 *
 * Feature: super-admin-platform
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */

// --- Types ---

/** The recognized privilege tiers across the platform. */
export type CredentialTier = "super_admin" | "store_admin" | "customer" | null;

/**
 * Describes what is known about a requester's credential at the time of the
 * authorization check. Built by upstream middleware from the raw token/session.
 */
export interface SuperAdminCredential {
  /** Whether a credential was presented at all. */
  present: boolean;
  /** The privilege tier identified from the credential, or null if unrecognizable. */
  tier: CredentialTier;
  /** Whether the credential has expired (e.g. token TTL exceeded). */
  expired: boolean;
  /** Whether the credential has been explicitly revoked. */
  revoked: boolean;
}

/**
 * The result of an authorization decision.
 */
export interface AuthorizationDecision {
  /** true if the requester is authorized as Super_Admin for the Control_Plane. */
  granted: boolean;
  /** Human-readable reason for denial (present only when granted=false). */
  reason?: string;
}

// --- Decision function ---

/**
 * Evaluate whether a credential grants Super_Admin access to the Control_Plane.
 *
 * Grant iff ALL of:
 *  - credential is present
 *  - tier is exactly `super_admin`
 *  - credential is not expired
 *  - credential is not revoked
 *
 * Any other combination results in denial with a descriptive reason.
 */
export function authorizeSuperAdmin(
  credential: SuperAdminCredential
): AuthorizationDecision {
  // R1.3: missing credential → deny
  if (!credential.present) {
    return { granted: false, reason: "credential_missing" };
  }

  // R1.5: wrong tier → deny
  if (credential.tier !== "super_admin") {
    return { granted: false, reason: "insufficient_tier" };
  }

  // R1.4: expired → deny
  if (credential.expired) {
    return { granted: false, reason: "credential_expired" };
  }

  // R1.4: revoked → deny
  if (credential.revoked) {
    return { granted: false, reason: "credential_revoked" };
  }

  // R1.2 + R1.6: all conditions met → grant
  return { granted: true };
}

/**
 * Check whether a granted Super_Admin decision also satisfies a Store_Admin-tier
 * requirement. Per R1.8, Super_Admin is a superset of Store_Admin privileges
 * within the Control_Plane context.
 *
 * This is a semantic helper for downstream code that needs to know "does this
 * decision satisfy at least Store_Admin level?" — useful when certain operations
 * are accessible to both tiers.
 *
 * Note: this does NOT grant access to any Store's database. It only indicates
 * tier hierarchy within the authorization model.
 */
export function satisfiesStoreAdminTier(decision: AuthorizationDecision): boolean {
  return decision.granted;
}
