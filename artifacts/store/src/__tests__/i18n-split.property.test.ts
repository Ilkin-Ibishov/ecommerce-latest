/**
 * i18n locale-split property tests (architecture-refactoring R13).
 *
 * Property 9 (Translation function preserves resolved strings across the split):
 * for any message key present in the canonical MessageSchema and any supported
 * locale, getT(locale)(key) returns the exact string the per-locale module
 * stores for that key; and for any key absent from the schema, getT returns the
 * key unchanged.
 *
 * This guards the behavior-preserving split of the former monolithic
 * `lib/i18n/messages.ts` into `lib/i18n/messages/{az,ru,en}.ts` + index/schema:
 * the runtime resolution (split on ".", walk object, return key on miss) must be
 * identical to what each locale module physically stores.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getT } from "@/lib/i18n/messages";
import az from "@/lib/i18n/messages/az";
import ru from "@/lib/i18n/messages/ru";
import en from "@/lib/i18n/messages/en";

const LOCALE_OBJECTS: Record<string, Record<string, unknown>> = { az, ru, en };
const LOCALES = ["az", "ru", "en"] as const;

/** Collect every dotted key path that resolves to a string leaf. */
function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") keys.push(path);
    else if (v && typeof v === "object") keys.push(...collectKeys(v as Record<string, unknown>, path));
  }
  return keys;
}

/** Resolve a dotted key against a locale object using the same algorithm as getT. */
function resolve(obj: Record<string, unknown>, key: string): string {
  const parts = key.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    cur = (cur as Record<string, unknown> | undefined)?.[p];
    if (cur === undefined) return key;
  }
  return typeof cur === "string" ? cur : key;
}

// az is the canonical schema; identical structure across locales is enforced by
// the existing i18n-consistency test, so az keys exist in every locale.
const ALL_KEYS = collectKeys(az);
const KEY_SET = new Set(ALL_KEYS);

describe("i18n locale split (getT)", () => {
  // Feature: architecture-refactoring, Property 9: Translation function preserves resolved strings across the split
  describe("Property 9: Translation function preserves resolved strings across the split", () => {
    // Validates: Requirements 13.3
    it("returns the exact string the per-locale module stores for any schema key + locale", () => {
      expect(ALL_KEYS.length).toBeGreaterThan(0);
      fc.assert(
        fc.property(fc.constantFrom(...LOCALES), fc.constantFrom(...ALL_KEYS), (locale, key) => {
          const t = getT(locale);
          expect(t(key)).toBe(resolve(LOCALE_OBJECTS[locale], key));
        }),
        { numRuns: 300 },
      );
    });

    it("returns the key unchanged for any key absent from the schema", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...LOCALES),
          fc.string().filter((s) => !KEY_SET.has(s)),
          (locale, missingKey) => {
            expect(getT(locale)(missingKey)).toBe(missingKey);
          },
        ),
        { numRuns: 300 },
      );
    });
  });
});
