import { describe, it, expect } from "vitest";
import {
  createStoreDefaults,
  transitionPlatformStatus,
} from "../src/lib/platform/lifecycle";
import { CreateStoreSchema } from "../src/routes/platform/lifecycle";

/**
 * Example/edge tests for registry-only Store creation.
 *
 * Feature: super-admin-platform
 * Requirements: 5.1, 5.10, 6.2, 9.2
 *
 * These are focused unit/edge tests (describe/it with expect), not property tests.
 * All assertions use pure function calls — no mocking needed.
 */

describe("createStoreDefaults — initial status values (R5.1, R6.2)", () => {
  it("always returns platformStatus 'onboarding'", () => {
    const defaults = createStoreDefaults();
    expect(defaults.platformStatus).toBe("onboarding");
  });

  it("always returns subscriptionStatus 'trialing'", () => {
    const defaults = createStoreDefaults();
    expect(defaults.subscriptionStatus).toBe("trialing");
  });

  it("returns exactly { platformStatus: 'onboarding', subscriptionStatus: 'trialing' }", () => {
    const defaults = createStoreDefaults();
    expect(defaults).toStrictEqual({
      platformStatus: "onboarding",
      subscriptionStatus: "trialing",
    });
  });

  it("returns consistent results across multiple calls", () => {
    const first = createStoreDefaults();
    const second = createStoreDefaults();
    expect(first).toStrictEqual(second);
  });
});

describe("CreateStoreSchema — registry-only, no provisioning fields (R5.10, R9.2)", () => {
  const validPayload = {
    name: "My Store",
    owner_email: "owner@example.com",
    instance_url: "https://mystore.example.com",
    metrics_endpoint_url: "https://mystore.example.com/api/metrics",
    per_store_credential_hash: "sha256:abc123def456",
  };

  it("accepts a valid registry-only payload with all required fields", () => {
    const result = CreateStoreSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("schema shape includes exactly: name, owner_email, instance_url, metrics_endpoint_url, per_store_credential_hash", () => {
    const schemaKeys = Object.keys(CreateStoreSchema.shape);
    expect(schemaKeys.sort()).toStrictEqual([
      "instance_url",
      "metrics_endpoint_url",
      "name",
      "owner_email",
      "per_store_credential_hash",
    ]);
  });

  it("does NOT include any provisioning field like database_url", () => {
    const schemaKeys = Object.keys(CreateStoreSchema.shape);
    const provisioningFields = [
      "database_url",
      "db_url",
      "supabase_url",
      "supabase_key",
      "infrastructure_config",
      "provisioning_config",
      "server_url",
      "deploy_target",
    ];
    for (const field of provisioningFields) {
      expect(schemaKeys).not.toContain(field);
    }
  });

  it("requires per_store_credential_hash — a hash/reference, not a raw secret field", () => {
    const schemaKeys = Object.keys(CreateStoreSchema.shape);
    // The only credential field is the hash/reference — not a raw secret
    expect(schemaKeys).toContain("per_store_credential_hash");
    // No raw-secret fields exist
    expect(schemaKeys).not.toContain("per_store_credential");
    expect(schemaKeys).not.toContain("secret");
    expect(schemaKeys).not.toContain("api_key");
    expect(schemaKeys).not.toContain("raw_credential");
  });

  it("rejects a payload missing 'name'", () => {
    const { name, ...noName } = validPayload;
    const result = CreateStoreSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing 'per_store_credential_hash'", () => {
    const { per_store_credential_hash, ...noCred } = validPayload;
    const result = CreateStoreSchema.safeParse(noCred);
    expect(result.success).toBe(false);
  });

  it("strips unknown fields (no extra provisioning data passes through)", () => {
    const withExtra = {
      ...validPayload,
      database_url: "postgres://leaked",
      provisioning_config: { region: "us-east-1" },
    };
    const result = CreateStoreSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
    if (result.success) {
      // Zod strips unknown keys by default
      expect(result.data).not.toHaveProperty("database_url");
      expect(result.data).not.toHaveProperty("provisioning_config");
    }
  });
});

describe("Lifecycle FSM — initial state can transition to active (R5.1, R5.2)", () => {
  it("createStoreDefaults() produces a valid initial state for the FSM", () => {
    const defaults = createStoreDefaults();
    // The platformStatus from defaults must be a valid FSM state
    expect(["onboarding", "active", "suspended", "disabled"]).toContain(
      defaults.platformStatus,
    );
  });

  it("a store starting as 'onboarding' can transition via 'activate' to 'active'", () => {
    const defaults = createStoreDefaults();
    const result = transitionPlatformStatus(defaults.platformStatus, "activate");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newStatus).toBe("active");
    }
  });

  it("a store starting as 'onboarding' cannot be directly disabled (must activate first)", () => {
    const defaults = createStoreDefaults();
    const result = transitionPlatformStatus(defaults.platformStatus, "disable");
    expect(result.success).toBe(false);
  });

  it("a store starting as 'onboarding' cannot be directly suspended", () => {
    const defaults = createStoreDefaults();
    const result = transitionPlatformStatus(defaults.platformStatus, "suspend");
    expect(result.success).toBe(false);
  });

  it("the full happy path: onboarding → activate → active → suspend → suspended → disable → disabled", () => {
    const defaults = createStoreDefaults();
    let status = defaults.platformStatus;

    // activate: onboarding → active
    const r1 = transitionPlatformStatus(status, "activate");
    expect(r1.success).toBe(true);
    if (r1.success) status = r1.newStatus;
    expect(status).toBe("active");

    // suspend: active → suspended
    const r2 = transitionPlatformStatus(status, "suspend");
    expect(r2.success).toBe(true);
    if (r2.success) status = r2.newStatus;
    expect(status).toBe("suspended");

    // disable: suspended → disabled
    const r3 = transitionPlatformStatus(status, "disable");
    expect(r3.success).toBe(true);
    if (r3.success) status = r3.newStatus;
    expect(status).toBe("disabled");
  });
});
