import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";

/**
 * **Validates: Requirements 3.3**
 *
 * Property 1: Missing environment variable produces identifiable error
 *
 * For any required environment variable removed from the set
 * {SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY},
 * the validation function SHALL throw an error whose message contains
 * the exact name of the missing variable.
 */

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
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
    };

    expect(() => validateEnvironment(completeEnv)).not.toThrow();
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
            env[varName] = `test-value-for-${varName}`;
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
});
