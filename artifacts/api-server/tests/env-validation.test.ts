import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { assertSessionSecret, deriveSessionPassword } from "../src/lib/session-secret";

/**
 * **Validates: Requirements 3.3**
 *
 * Property 1: Missing environment variable produces identifiable error
 *
 * For any required environment variable removed from the set
 * {SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET},
 * the validation function SHALL throw an error whose message contains
 * the exact name of the missing variable.
 */

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SESSION_SECRET",
] as const;

type RequiredVar = (typeof REQUIRED_VARS)[number];

/**
 * Extracted validation logic matching setup.ts behavior.
 * Validates that all required environment variables are present in the given env record.
 * Throws an error with the missing variable name if any is absent.
 */
function validateEnvironment(env: Record<string, string | undefined>): void {
  for (const varName of REQUIRED_VARS) {
    if (!env[varName]) {
      throw new Error(
        `Missing required environment variable: ${varName}. ` +
          `Ensure it is defined in .env or .env.test at the repository root.`
      );
    }
  }

  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 characters long."
    );
  }
}

describe("Environment validation", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Save current env values for required vars
    savedEnv = {};
    for (const varName of REQUIRED_VARS) {
      savedEnv[varName] = process.env[varName];
    }
  });

  afterEach(() => {
    // Restore env values
    for (const varName of REQUIRED_VARS) {
      if (savedEnv[varName] !== undefined) {
        process.env[varName] = savedEnv[varName];
      } else {
        delete process.env[varName];
      }
    }
  });

  it("should pass validation when all required variables are present", () => {
    const completeEnv: Record<string, string> = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key-value",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-value",
      SESSION_SECRET: "a-valid-session-secret-that-is-at-least-32-chars-long",
    };

    expect(() => validateEnvironment(completeEnv)).not.toThrow();
  });

  it("should fail validation when SESSION_SECRET is shorter than 32 characters", () => {
    const weakEnv: Record<string, string> = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key-value",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-value",
      SESSION_SECRET: "short-secret",
    };

    expect(() => validateEnvironment(weakEnv)).toThrow(
      "SESSION_SECRET must be at least 32 characters long."
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Property: For any required environment variable removed from the set,
   * the validation function throws an error whose message contains the
   * exact name of the missing variable.
   */
  it("property: missing any required variable produces error containing that variable name", () => {
    // Arbitrary that picks one of the required variable names
    const requiredVarArb = fc.constantFrom(...REQUIRED_VARS);

    fc.assert(
      fc.property(requiredVarArb, (missingVar: RequiredVar) => {
        // Build an env with all vars present except the chosen one
        const env: Record<string, string | undefined> = {};
        for (const varName of REQUIRED_VARS) {
          if (varName === missingVar) {
            env[varName] = undefined;
          } else {
            env[varName] = `test-value-for-${varName}-extended-to-satisfy-min-length-32`;
          }
        }

        // Validation must throw
        let thrownError: Error | undefined;
        try {
          validateEnvironment(env);
        } catch (e) {
          thrownError = e as Error;
        }

        // Assert it threw
        expect(thrownError).toBeInstanceOf(Error);

        // Assert error message contains the exact missing variable name
        expect(thrownError!.message).toContain(missingVar);
      }),
      { numRuns: 100 }
    );
  });

  describe("assertSessionSecret", () => {
    it("should throw when SESSION_SECRET is absent", () => {
      expect(() => assertSessionSecret(undefined)).toThrow(
        "SESSION_SECRET environment variable is required but was not provided."
      );
      expect(() => assertSessionSecret("")).toThrow(
        "SESSION_SECRET environment variable is required but was not provided."
      );
    });

    it("should throw when SESSION_SECRET is shorter than 32 characters", () => {
      expect(() => assertSessionSecret("too-short")).toThrow(
        "SESSION_SECRET must be at least 32 characters long."
      );
    });

    it("should return secret when valid", () => {
      const validSecret = "a".repeat(32);
      expect(assertSessionSecret(validSecret)).toBe(validSecret);
    });
  });

  describe("deriveSessionPassword", () => {
    it("should throw when SESSION_SECRET is absent or weak", () => {
      expect(() => deriveSessionPassword("user-123", undefined)).toThrow();
      expect(() => deriveSessionPassword("user-123", "short")).toThrow();
    });

    it("should derive deterministic 32-character hex string when secret is valid", () => {
      const secret = "valid-secret-key-that-is-at-least-32-chars-long";
      const pass1 = deriveSessionPassword("user-123", secret);
      const pass2 = deriveSessionPassword("user-123", secret);
      expect(pass1).toBe(pass2);
      expect(pass1).toHaveLength(32);
      expect(pass1).toMatch(/^[0-9a-f]{32}$/);
    });

    it("should produce different passwords for different userIds", () => {
      const secret = "valid-secret-key-that-is-at-least-32-chars-long";
      const passA = deriveSessionPassword("user-A", secret);
      const passB = deriveSessionPassword("user-B", secret);
      expect(passA).not.toBe(passB);
    });
  });
});
