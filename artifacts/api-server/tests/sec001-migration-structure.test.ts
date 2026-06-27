import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SEC-001 — Structural assertion that the role-immutability migration ships ALL
 * THREE defenses (vitest, no DB).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    7 (P0 unit/property tests) — TEST-FIRST.
 * Design:  Property 1 — the fix SHALL apply all three defenses together:
 *            (a) `users` is SELECT-only for clients,
 *            (b) `grant update (full_name, default_address)` only (never role/email/phone),
 *            (c) a `before update` trigger rejecting any role change off the service role.
 * Requirements: 2.1.
 *
 * ── Why a file read, not an import ──────────────────────────────────────────
 * This is a STRUCTURAL check on a SQL migration that does not exist yet
 * (created by task 4). Per task guidance we read the migration at runtime and
 * fail meaningfully ("migration not found") rather than crash collection. The
 * exact date-prefix may be adjusted at apply time (design.md notes the prefix
 * encodes ordering and is set to the real apply date), so we resolve the file
 * by GLOB on the stable `sec001` / `role_immutability` tokens, preferring the
 * canonical `20240101_sec001_users_role_immutability.sql` name from task 4.
 */

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  "../../../supabase/migrations",
);
const CANONICAL_NAME = "20240101_sec001_users_role_immutability.sql";

function findSec001Migration(): { file: string; sql: string } | null {
  if (!fs.existsSync(MIGRATIONS_DIR)) return null;
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

  // Prefer the canonical name, then any file whose name carries the stable tokens.
  const exact = files.find((f) => f === CANONICAL_NAME);
  const byToken = files.find(
    (f) => /sec001/i.test(f) && /(role|immutab)/i.test(f),
  );
  const chosen = exact ?? byToken;
  if (!chosen) return null;

  return { file: chosen, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, chosen), "utf-8") };
}

describe("SEC-001 migration ships all three defenses (Property 1)", () => {
  let migration: { file: string; sql: string } | null = null;
  /** Normalized (whitespace-collapsed, lower-cased) SQL for tolerant matching. */
  let sqlNorm = "";

  beforeAll(() => {
    migration = findSec001Migration();
    if (migration) sqlNorm = migration.sql.replace(/\s+/g, " ").toLowerCase();
  });

  function requireMigration(): void {
    if (!migration) {
      throw new Error(
        `SEC-001 migration not found in supabase/migrations (looked for ${CANONICAL_NAME} ` +
          "or a *sec001*role/immutability*.sql file — pending task 4, the expected red state).",
      );
    }
  }

  it("(a) replaces the for-all own-row policy with a SELECT-only client policy", () => {
    requireMigration();
    // The broad `for all` own-row policy is dropped...
    expect(/drop policy if exists .*users.* on public\.users/.test(sqlNorm)).toBe(true);
    // ...and a SELECT-only own-row policy is created (auth.uid() = id).
    expect(sqlNorm).toContain("for select");
    expect(/create policy[^;]*for select[^;]*using \(auth\.uid\(\) = id\)/.test(sqlNorm)).toBe(true);
  });

  it("(b) grants UPDATE only on full_name + default_address (never role/email/phone)", () => {
    requireMigration();
    // The broad UPDATE grant is revoked from authenticated.
    expect(/revoke update on public\.users from authenticated/.test(sqlNorm)).toBe(true);
    // The narrow column grant lists exactly the two profile columns.
    expect(
      /grant update \(\s*full_name\s*,\s*default_address\s*\) on public\.users to authenticated/.test(
        sqlNorm,
      ),
    ).toBe(true);
    // The grant must NOT widen to role / email / phone.
    expect(/grant update \([^)]*\brole\b[^)]*\)/.test(sqlNorm)).toBe(false);
    expect(/grant update \([^)]*\bemail\b[^)]*\)/.test(sqlNorm)).toBe(false);
    expect(/grant update \([^)]*\bphone\b[^)]*\)/.test(sqlNorm)).toBe(false);
  });

  it("(c) adds a BEFORE UPDATE role-immutability trigger that rejects off-service-role role changes", () => {
    requireMigration();
    // The guard function exists and keys off a role change.
    expect(sqlNorm).toContain("enforce_role_immutability");
    expect(/new\.role is distinct from old\.role/.test(sqlNorm)).toBe(true);
    // It raises (rejects) — design uses errcode 42501.
    expect(/raise exception/.test(sqlNorm)).toBe(true);
    expect(sqlNorm).toContain("42501");
    // A BEFORE UPDATE trigger on public.users wires it in.
    expect(/create trigger[^;]*before update on public\.users/.test(sqlNorm)).toBe(true);
  });

  it("ships all three defenses together (single combined check)", () => {
    requireMigration();
    const hasSelectOnly =
      sqlNorm.includes("for select") &&
      /using \(auth\.uid\(\) = id\)/.test(sqlNorm);
    const hasColumnGrant =
      /grant update \(\s*full_name\s*,\s*default_address\s*\) on public\.users to authenticated/.test(
        sqlNorm,
      );
    const hasTrigger =
      sqlNorm.includes("enforce_role_immutability") &&
      /create trigger[^;]*before update on public\.users/.test(sqlNorm);

    expect({ hasSelectOnly, hasColumnGrant, hasTrigger }).toEqual({
      hasSelectOnly: true,
      hasColumnGrant: true,
      hasTrigger: true,
    });
  });
});
