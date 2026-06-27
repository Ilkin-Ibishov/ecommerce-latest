import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SEC-002 + SEC-004 — Structural assertions that the P1 RLS migrations ship the
 * required policy changes (vitest, no DB).
 *
 * Spec:    .kiro/specs/supabase-rls-security-fixes  (bugfix)
 * Task:    15 (P1 unit/property tests) — TEST-FIRST.
 * Design:  Property 2 — SEC-002 drops the `size_guides` world-write policy
 *            (`size_guides_admin_write`), retaining only the public read.
 *          Property 4 — SEC-004 rewrites the `comments` own-insert policy so its
 *            WITH CHECK expression includes `approved = false` (moderation
 *            enforced at insert).
 * Requirements: 2.2, 2.4.
 *
 * ── Why a file read, not an import (mirrors sec001-migration-structure.test.ts) ─
 * These are STRUCTURAL checks on SQL migrations that do not exist yet (created by
 * tasks 11 and 13). Per task guidance we read each migration at runtime and FAIL
 * MEANINGFULLY ("migration not found … pending task N") rather than crash
 * collection. The date prefix may be adjusted at apply time (design.md notes the
 * prefix only encodes ordering), so each file is resolved by GLOB on stable
 * tokens, preferring the canonical name from the task.
 */

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  "../../../supabase/migrations",
);

type Migration = { file: string; sql: string };

/**
 * Resolve a migration file by a canonical name first, then by a token predicate
 * over the remaining `.sql` files. Returns null when nothing matches (the
 * expected RED state before the fix migration is authored).
 */
function findMigration(
  canonicalName: string,
  matches: (file: string) => boolean,
): Migration | null {
  if (!fs.existsSync(MIGRATIONS_DIR)) return null;
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const chosen = files.find((f) => f === canonicalName) ?? files.find(matches);
  if (!chosen) return null;
  return {
    file: chosen,
    sql: fs.readFileSync(path.join(MIGRATIONS_DIR, chosen), "utf-8"),
  };
}

/** Whitespace-collapsed, lower-cased SQL for tolerant matching. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

describe("SEC-002 migration drops the size_guides world-write policy (Property 2)", () => {
  const CANONICAL = "20240102_sec002_drop_size_guides_world_write.sql";
  let migration: Migration | null = null;
  let sqlNorm = "";

  beforeAll(() => {
    migration = findMigration(
      CANONICAL,
      (f) => /sec002/i.test(f) && /size_guides/i.test(f),
    );
    if (migration) sqlNorm = normalize(migration.sql);
  });

  function requireMigration(): void {
    if (!migration) {
      throw new Error(
        `SEC-002 migration not found in supabase/migrations (looked for ${CANONICAL} ` +
          "or a *sec002*size_guides*.sql file — pending task 11, the expected RED state).",
      );
    }
  }

  it("drops the world-write policy on public.size_guides", () => {
    requireMigration();
    // The world-write policy (using(true) with check(true)) is dropped.
    expect(/drop policy if exists[^;]*size_guides_admin_write[^;]*on public\.size_guides/.test(sqlNorm)).toBe(true);
  });

  it("does NOT drop the retained public read policy", () => {
    requireMigration();
    // Preservation [3.2]: the public select policy must survive. If the migration
    // touches a read policy at all, it must not be a `drop` of the read policy.
    expect(/drop policy if exists[^;]*size_guides_read/.test(sqlNorm)).toBe(false);
  });
});

describe("SEC-004 migration constrains the comments insert to approved = false (Property 4)", () => {
  const CANONICAL = "20240104_sec004_comments_insert_unapproved_only.sql";
  let migration: Migration | null = null;
  let sqlNorm = "";

  beforeAll(() => {
    migration = findMigration(
      CANONICAL,
      (f) => /sec004/i.test(f) && /comments/i.test(f),
    );
    if (migration) sqlNorm = normalize(migration.sql);
  });

  function requireMigration(): void {
    if (!migration) {
      throw new Error(
        `SEC-004 migration not found in supabase/migrations (looked for ${CANONICAL} ` +
          "or a *sec004*comments*.sql file — pending task 13, the expected RED state).",
      );
    }
  }

  it("recreates the own-insert policy as an INSERT policy on public.comments", () => {
    requireMigration();
    // The prior policy is dropped and recreated for insert.
    expect(/drop policy if exists[^;]*comments[^;]*on public\.comments/.test(sqlNorm)).toBe(true);
    expect(/create policy[^;]*on public\.comments[^;]*for insert/.test(sqlNorm)).toBe(true);
  });

  it("the WITH CHECK expression includes approved = false (moderation enforced)", () => {
    requireMigration();
    // The moderation invariant: a self-insert can only land unapproved.
    expect(sqlNorm).toContain("approved = false");
    // ...and it is part of the insert check (ownership AND approved = false).
    expect(/with check[^;]*auth\.uid\(\) = user_id[^;]*approved = false/.test(sqlNorm)).toBe(true);
  });
});
