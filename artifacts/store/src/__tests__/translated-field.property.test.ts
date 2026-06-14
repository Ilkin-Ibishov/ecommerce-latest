import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getTranslatedField } from "@/lib/utils";

// ─── Generators ─────────────────────────────────────────────────────────────────

// A short, lowercase locale-like code (e.g. "az", "ru", "en", "abc").
const codeArb = fc
  .array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    { minLength: 1, maxLength: 4 },
  )
  .map((chars) => chars.join(""));

// A field value that is always present (non-null/undefined) so the resolution
// order is exercised deterministically. Includes the empty string, which the
// util returns as-is.
const fieldValueArb = fc.string({ maxLength: 12 });

// Which key shape an entry uses to carry its locale code.
const keyShapeArb = fc.constantFrom<"lang_code" | "locale">(
  "lang_code",
  "locale",
);

type Entry = Record<string, unknown>;

function makeEntry(
  keyShape: "lang_code" | "locale",
  code: string,
  fieldName: string,
  fieldValue: string,
): Entry {
  return { [keyShape]: code, [fieldName]: fieldValue };
}

// ─── Property 5: Translation lookup returns the matching locale's field for both key shapes ───
// Feature: architecture-refactoring, Property 5: for any translation list that
// contains an entry for the requested locale (entries keyed by `lang_code` OR by
// `locale`), getTranslatedField returns that matching entry's `field` value.
// Validates: Requirements 8.2, 8.3, 8.4

describe("Property 5: matching-locale field is returned for both key shapes", () => {
  it("returns the matching entry's field value regardless of key shape", () => {
    fc.assert(
      fc.property(
        codeArb, // requested locale
        keyShapeArb, // key shape of the matching entry
        fieldValueArb, // matching entry's field value
        fc.array(
          fc.record({
            keyShape: keyShapeArb,
            code: codeArb,
            value: fieldValueArb,
          }),
          { maxLength: 6 },
        ),
        fc.nat(), // insertion position for the matching entry
        (requestedLocale, matchKeyShape, matchValue, others, pos) => {
          const fieldName = "title";

          // Non-matching entries: ensure none carries the requested locale under
          // either key shape.
          const nonMatching = others
            .filter((o) => o.code !== requestedLocale)
            .map((o) => makeEntry(o.keyShape, o.code, fieldName, o.value));

          const matchEntry = makeEntry(
            matchKeyShape,
            requestedLocale,
            fieldName,
            matchValue,
          );

          // Insert the (single) matching entry at an arbitrary position.
          const insertAt = nonMatching.length === 0 ? 0 : pos % (nonMatching.length + 1);
          const translations = [
            ...nonMatching.slice(0, insertAt),
            matchEntry,
            ...nonMatching.slice(insertAt),
          ];

          const result = getTranslatedField(
            translations,
            requestedLocale,
            fieldName,
            "FALLBACK",
          );

          expect(result).toBe(matchValue);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Property 6: Translation lookup falls back deterministically ──────────────────
// Feature: architecture-refactoring, Property 6: for any non-empty list with NO
// entry matching the requested locale, returns the first entry's `field`; and for
// an empty/null/undefined list, returns `fallback`.
// Validates: Requirements 8.4, 8.5

describe("Property 6: deterministic fallback behavior", () => {
  it("returns the first entry's field when no entry matches the requested locale", () => {
    fc.assert(
      fc.property(
        codeArb, // requested locale
        fc.array(
          fc.record({
            keyShape: keyShapeArb,
            code: codeArb,
            value: fieldValueArb,
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (requestedLocale, entries) => {
          const fieldName = "title";

          // Force a non-matching list by suffixing every code so none equals the
          // requested locale under either key shape.
          const translations = entries.map((e) =>
            makeEntry(e.keyShape, `${e.code}-x`, fieldName, e.value),
          );

          // Precondition: requestedLocale never matches the mangled codes.
          fc.pre(
            translations.every(
              (t) =>
                t.lang_code !== requestedLocale && t.locale !== requestedLocale,
            ),
          );

          const result = getTranslatedField(
            translations,
            requestedLocale,
            fieldName,
            "FALLBACK",
          );

          expect(result).toBe(entries[0].value);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns the fallback for empty, null, or undefined lists", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Array<Entry> | null | undefined>([], null, undefined),
        codeArb,
        fc.string({ maxLength: 12 }), // field name
        fc.string({ maxLength: 12 }), // fallback
        (translations, locale, field, fallback) => {
          const result = getTranslatedField(translations, locale, field, fallback);
          expect(result).toBe(fallback);
        },
      ),
      { numRuns: 200 },
    );
  });
});
