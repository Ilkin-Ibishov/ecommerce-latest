import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SEC-007 — Structural assertion that the control-plane deny-by-default
 * assertion migration ships and is shaped to FAIL CLOSED (vitest, no DB).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    22 — "Unit tests for SEC-006 / SEC-007 (vitest, no DB)", the optional
 *            control-plane deny-by-default MIGRATION structural assertion.
 * Design:  Property 7 — control-plane tables SHALL be asserted deny-by-default
 *            (RLS enabled, no policies) via a migration/test.
 * Requirements: 2.7 (and 2.10 — the assertion ships as a migration).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RELATIONSHIP TO THE OTHER P2 FILES (no duplication — agent-behaviors rule #5)
 * ─────────────────────────────────────────────────────────────────────────────
 *   • `sec005-007-p2.exploration.test.ts` (task 17) OWNS the SEC-006/SEC-007
 *     UNFIXED-state observations behind the manual `P2_FIXED` toggle, plus the
 *     SEC-005 recursion-refutation invariant.
 *   • `sec006-sec007-p2-unit.test.ts` (task 22, canonical) OWNS the toggle-free
 *     SEC-006 fail-fast + [3.6] preservation + boot-guard unit contract and the
 *     SEC-007 `vercel.json` credential-absence contract.
 *   • THIS file owns the ONE task-22 piece neither of the above covers: the
 *     STRUCTURAL assertion over the control-plane deny-by-default migration
 *     `supabase/control-plane/migrations/009_assert_deny_by_default.sql`
 *     (authored by task 20.2). It does not re-assert anything in those files.
 *
 * ── Why a file read, not a DB run (mirrors sec00{1,2,4}-migration-structure) ──
 * This is a STRUCTURAL check on a SQL migration that does not exist yet (created
 * by task 20.2). Per task guidance we read the migration at runtime and FAIL
 * MEANINGFULLY ("migration not found … pending task 20.2") rather than crash
 * collection. The numeric prefix may be adjusted at apply time, so the file is
 * resolved by GLOB on stable tokens, preferring the canonical name from the task.
 *
 * TEST-FIRST CONTRACT: written BEFORE task 20.2 authors the migration → RED
 * (meaningful "not found") on current code, GREEN once the deny-by-default
 * assertion migration lands. No fix is implemented by this task.
 */

const CONTROL_PLANE_MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  "../../../supabase/control-plane/migrations",
);
const CANONICAL_NAME = "009_assert_deny_by_default.sql";

type Migration = { file: string; sql: string };

/**
 * Resolve the deny-by-default migration by canonical name first, then by a
 * token predicate over the remaining `.sql` files. Returns null when nothing
 * matches (the expected RED state before task 20.2 authors the migration).
 */
function findMigration(): Migration | null {
  if (!fs.existsSync(CONTROL_PLANE_MIGRATIONS_DIR)) return null;
  const files = fs
    .readdirSync(CONTROL_PLANE_MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"));
  const chosen =
    files.find((f) => f === CANONICAL_NAME) ??
    files.find((f) => /deny.?by.?default/i.test(f)) ??
    files.find((f) => /assert/i.test(f) && /deny/i.test(f));
  if (!chosen) return null;
  return {
    file: chosen,
    sql: fs.readFileSync(path.join(CONTROL_PLANE_MIGRATIONS_DIR, chosen), "utf-8"),
  };
}

/** Whitespace-collapsed, lower-cased SQL for tolerant matching. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

describe("SEC-007 control-plane deny-by-default assertion migration (Property 7 — structural, Fix-Checking)", () => {
  let migration: Migration | null = null;
  let sqlNorm = "";

  beforeAll(() => {
    migration = findMigration();
    if (migration) sqlNorm = normalize(migration.sql);
  });

  function requireMigration(): void {
    if (!migration) {
      throw new Error(
        `SEC-007 control-plane deny-by-default migration not found in ` +
          `supabase/control-plane/migrations (looked for ${CANONICAL_NAME} or a ` +
          `*deny_by_default*.sql file — pending task 20.2, the expected RED state).`,
      );
    }
  }

  it("the migration file exists (pending task 20.2 — fails meaningfully if absent)", () => {
    requireMigration();
    expect(migration!.sql.trim().length).toBeGreaterThan(0);
  });

  it("uses an anonymous PL/pgSQL DO block so it executes (and can raise) at apply time", () => {
    requireMigration();
    // design/task 20.2: a `do $$ … $$` block. Tolerant to `do $$` / `do $tag$`.
    expect(/\bdo\s+\$[a-z0-9_]*\$/.test(sqlNorm)).toBe(true);
    expect(/language\s+plpgsql|\bplpgsql\b|\bbegin\b/.test(sqlNorm)).toBe(true);
  });

  it("raises (fails closed) rather than silently passing", () => {
    requireMigration();
    // The whole point of the assertion migration is to RAISE on violation.
    expect(/raise\s+exception/.test(sqlNorm)).toBe(true);
  });

  it("raises if RLS is DISABLED on a control-plane public table", () => {
    requireMigration();
    // RLS-disabled detection keys off pg_class.relrowsecurity in the public schema.
    expect(sqlNorm).toContain("relrowsecurity");
    // It must check for the DISABLED case (not relrowsecurity / relrowsecurity = false).
    expect(
      /not\s+[a-z0-9_."]*relrowsecurity|relrowsecurity\s*=\s*false|relrowsecurity\s+is\s+false/.test(
        sqlNorm,
      ),
    ).toBe(true);
    // Scoped to the public schema (control-plane tables live in public).
    expect(/'public'|"public"|\bpublic\b/.test(sqlNorm)).toBe(true);
  });

  it("raises if ANY policy EXISTS on a control-plane public table", () => {
    requireMigration();
    // Policy-existence detection keys off the catalog (pg_policies / pg_policy).
    expect(/pg_policies|pg_policy\b/.test(sqlNorm)).toBe(true);
    // Deny-by-default means ZERO policies — the assertion looks for any policy
    // in the public schema (count > 0 / exists) to fail closed.
    expect(/schemaname\s*=\s*'public'|\bpublic\b/.test(sqlNorm)).toBe(true);
  });

  it("combined: asserts BOTH invariants (RLS enabled AND no policies) in one migration", () => {
    requireMigration();
    const checksRlsDisabled =
      sqlNorm.includes("relrowsecurity") &&
      /not\s+[a-z0-9_."]*relrowsecurity|relrowsecurity\s*=\s*false|relrowsecurity\s+is\s+false/.test(
        sqlNorm,
      );
    const checksPolicyExists = /pg_policies|pg_policy\b/.test(sqlNorm);
    const failsClosed = /raise\s+exception/.test(sqlNorm);

    expect({ checksRlsDisabled, checksPolicyExists, failsClosed }).toEqual({
      checksRlsDisabled: true,
      checksPolicyExists: true,
      failsClosed: true,
    });
  });
});
