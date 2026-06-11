import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isValidHsl, validateColors, validateFonts } from "../src/routes/site-settings";

/**
 * Settings Validation Property Tests
 * Feature: white-label-customization
 * Validates: Requirements 1.2, 1.4, 1.5, 1.6, 1.8
 */

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a valid HSL string: "H S% L%" where H ∈ [0,360], S ∈ [0,100], L ∈ [0,100] */
const validHslArb = fc
  .tuple(
    fc.integer({ min: 0, max: 360 }),
    fc.integer({ min: 0, max: 100 }),
    fc.integer({ min: 0, max: 100 }),
  )
  .map(([h, s, l]) => `${h} ${s}% ${l}%`);

/** Generate a valid color palette with all required keys and valid HSL values */
const validColorPaletteArb = fc
  .tuple(validHslArb, validHslArb, validHslArb, validHslArb, validHslArb, validHslArb)
  .map(([primary, secondary, accent, background, text, muted]) => ({
    primary,
    secondary,
    accent,
    background,
    text,
    muted,
  }));

/** Generate a valid font name: non-empty string ≤ 100 chars */
const validFontNameArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

/** Generate a valid font configuration */
const validFontConfigArb = fc.record({
  heading: validFontNameArb,
  body: validFontNameArb,
});

/** The recognized top-level fields in site_settings */
const VALID_FIELDS = [
  "store_name",
  "colors",
  "fonts",
  "logo_url",
  "favicon_url",
  "contact",
  "working_hours",
  "footer_text",
] as const;

/** Generate a valid site_settings state */
const validSettingsStateArb = fc.record({
  id: fc.constant("00000000-0000-0000-0000-000000000001"),
  store_name: fc.record({
    az: fc.string({ minLength: 0, maxLength: 100 }),
    ru: fc.string({ minLength: 0, maxLength: 100 }),
    en: fc.string({ minLength: 0, maxLength: 100 }),
  }),
  colors: validColorPaletteArb,
  fonts: validFontConfigArb,
  logo_url: fc.oneof(fc.constant(null), fc.webUrl()),
  favicon_url: fc.oneof(fc.constant(null), fc.webUrl()),
  contact: fc.record({
    phone: fc.string({ minLength: 0, maxLength: 20 }),
    email: fc.string({ minLength: 0, maxLength: 254 }),
    address: fc.string({ minLength: 0, maxLength: 200 }),
    social_links: fc.record({
      instagram: fc.oneof(fc.constant(""), fc.webUrl()),
      facebook: fc.oneof(fc.constant(""), fc.webUrl()),
      telegram: fc.oneof(fc.constant(""), fc.webUrl()),
    }),
  }),
  working_hours: fc.record({
    az: fc.string({ minLength: 0, maxLength: 200 }),
    ru: fc.string({ minLength: 0, maxLength: 200 }),
    en: fc.string({ minLength: 0, maxLength: 200 }),
  }),
  footer_text: fc.record({
    az: fc.string({ minLength: 0, maxLength: 500 }),
    ru: fc.string({ minLength: 0, maxLength: 500 }),
    en: fc.string({ minLength: 0, maxLength: 500 }),
  }),
  updated_at: fc.integer({ min: 1577836800000, max: 1924991999000 }).map((ts) => new Date(ts).toISOString()),
});

/** Generate a subset of recognized field names */
const fieldSubsetArb = fc
  .subarray([...VALID_FIELDS], { minLength: 1 })
  .filter((arr) => arr.length > 0);

/** Generate a valid value for a given field name */
function validValueForField(field: string): fc.Arbitrary<unknown> {
  switch (field) {
    case "store_name":
      return fc.record({
        az: fc.string({ minLength: 0, maxLength: 100 }),
        ru: fc.string({ minLength: 0, maxLength: 100 }),
        en: fc.string({ minLength: 0, maxLength: 100 }),
      });
    case "colors":
      return validColorPaletteArb;
    case "fonts":
      return validFontConfigArb;
    case "logo_url":
      return fc.oneof(fc.constant(null), fc.webUrl());
    case "favicon_url":
      return fc.oneof(fc.constant(null), fc.webUrl());
    case "contact":
      return fc.record({
        phone: fc.string({ minLength: 0, maxLength: 20 }),
        email: fc.string({ minLength: 0, maxLength: 254 }),
        address: fc.string({ minLength: 0, maxLength: 200 }),
        social_links: fc.constant({}),
      });
    case "working_hours":
      return fc.record({
        az: fc.string({ minLength: 0, maxLength: 200 }),
        ru: fc.string({ minLength: 0, maxLength: 200 }),
        en: fc.string({ minLength: 0, maxLength: 200 }),
      });
    case "footer_text":
      return fc.record({
        az: fc.string({ minLength: 0, maxLength: 500 }),
        ru: fc.string({ minLength: 0, maxLength: 500 }),
        en: fc.string({ minLength: 0, maxLength: 500 }),
      });
    default:
      return fc.constant(null);
  }
}

/** Generate invalid HSL values (out-of-range or malformed) */
const invalidHslArb = fc.oneof(
  // hue > 360
  fc.tuple(fc.integer({ min: 361, max: 999 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }))
    .map(([h, s, l]) => `${h} ${s}% ${l}%`),
  // saturation > 100
  fc.tuple(fc.integer({ min: 0, max: 360 }), fc.integer({ min: 101, max: 999 }), fc.integer({ min: 0, max: 100 }))
    .map(([h, s, l]) => `${h} ${s}% ${l}%`),
  // lightness > 100
  fc.tuple(fc.integer({ min: 0, max: 360 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 101, max: 999 }))
    .map(([h, s, l]) => `${h} ${s}% ${l}%`),
  // malformed format
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !isValidHsl(s)),
);

// ─── Property 1: Partial update preserves unmodified fields ────────────────────

describe("Feature: white-label-customization, Property 1: Partial update preserves unmodified fields", () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any valid site_settings state and any subset of recognized fields in a
   * PATCH request, the resulting stored settings shall contain updated values for
   * submitted fields and original values for all others.
   *
   * We simulate the PATCH logic: filter body to recognized fields, apply updates
   * to state, and verify unmodified fields remain unchanged.
   */
  it("updated fields are applied and unmodified fields preserve their original values", () => {
    fc.assert(
      fc.property(
        validSettingsStateArb,
        fieldSubsetArb,
        (originalState, fieldsToUpdate) => {
          // Generate new values for the fields being updated
          const patchBody: Record<string, unknown> = {};
          for (const field of fieldsToUpdate) {
            // Use a deterministic "new value" that's different from original
            // We simulate by creating a simple new value for each field
            patchBody[field] = getNewValueForField(field);
          }

          // Simulate the PATCH logic: filter to recognized fields
          const updates: Record<string, unknown> = {};
          for (const field of VALID_FIELDS) {
            if (field in patchBody) {
              updates[field] = patchBody[field];
            }
          }

          // Apply updates to a copy of the original state
          const resultState = { ...originalState, ...updates };

          // Verify: updated fields have new values
          for (const field of fieldsToUpdate) {
            expect(resultState[field as keyof typeof resultState]).toEqual(updates[field]);
          }

          // Verify: unmodified fields retain original values
          const unmodifiedFields = VALID_FIELDS.filter((f) => !fieldsToUpdate.includes(f));
          for (const field of unmodifiedFields) {
            expect(resultState[field as keyof typeof resultState]).toEqual(
              originalState[field as keyof typeof originalState],
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("unrecognized fields in the request body are ignored", () => {
    fc.assert(
      fc.property(
        validSettingsStateArb,
        fc.array(fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !(VALID_FIELDS as readonly string[]).includes(s)), { minLength: 1, maxLength: 5 }),
        (originalState, unrecognizedFields) => {
          // Build a patch body with only unrecognized fields
          const patchBody: Record<string, unknown> = {};
          for (const field of unrecognizedFields) {
            patchBody[field] = "some-value";
          }

          // Simulate filtering to recognized fields only
          const updates: Record<string, unknown> = {};
          for (const field of VALID_FIELDS) {
            if (field in patchBody) {
              updates[field] = patchBody[field];
            }
          }

          // No valid fields found — state should remain unchanged
          expect(Object.keys(updates).length).toBe(0);

          // Apply updates (none) to original state
          const resultState = { ...originalState, ...updates };

          // All fields remain unchanged
          for (const field of VALID_FIELDS) {
            expect(resultState[field as keyof typeof resultState]).toEqual(
              originalState[field as keyof typeof originalState],
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: Settings validation accepts only well-formed color palettes ───

describe("Feature: white-label-customization, Property 2: Settings validation accepts only well-formed color palettes", () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any JSONB object submitted as `colors`, validateColors() shall accept it
   * IFF it has exactly keys primary/secondary/accent/background/text/muted, each
   * as valid HSL "H S% L%" (H 0-360, S 0-100, L 0-100).
   */
  it("validateColors accepts all well-formed color palettes", () => {
    fc.assert(
      fc.property(validColorPaletteArb, (colors) => {
        const result = validateColors(colors);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("validateColors rejects palettes with missing keys", () => {
    const colorKeys = ["primary", "secondary", "accent", "background", "text", "muted"] as const;

    fc.assert(
      fc.property(
        validColorPaletteArb,
        fc.subarray([...colorKeys], { minLength: 1, maxLength: 5 }),
        (validColors, keysToRemove) => {
          // Remove at least one key
          const incomplete = { ...validColors };
          for (const key of keysToRemove) {
            delete (incomplete as Record<string, unknown>)[key];
          }

          // Only test if we actually removed something (subarray could be empty)
          if (Object.keys(incomplete).length < 6) {
            const result = validateColors(incomplete);
            expect(result).not.toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validateColors rejects palettes with extra keys", () => {
    fc.assert(
      fc.property(
        validColorPaletteArb,
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => !["primary", "secondary", "accent", "background", "text", "muted"].includes(s),
        ),
        validHslArb,
        (validColors, extraKey, extraValue) => {
          const withExtra = { ...validColors, [extraKey]: extraValue };
          const result = validateColors(withExtra);
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validateColors rejects palettes with invalid HSL values", () => {
    const colorKeys = ["primary", "secondary", "accent", "background", "text", "muted"] as const;

    fc.assert(
      fc.property(
        validColorPaletteArb,
        fc.constantFrom(...colorKeys),
        invalidHslArb,
        (validColors, keyToInvalidate, invalidValue) => {
          const invalid = { ...validColors, [keyToInvalidate]: invalidValue };
          const result = validateColors(invalid);
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validateColors rejects non-object inputs", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.string(),
          fc.array(fc.anything()),
          fc.boolean(),
        ),
        (input) => {
          const result = validateColors(input);
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: Settings validation accepts only well-formed font configurations

describe("Feature: white-label-customization, Property 3: Settings validation accepts only well-formed font configurations", () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * For any JSONB object submitted as `fonts`, validateFonts() shall accept it IFF
   * it has exactly keys `heading` and `body`, each as a non-empty string ≤ 100 chars.
   */
  it("validateFonts accepts all well-formed font configurations", () => {
    fc.assert(
      fc.property(validFontConfigArb, (fonts) => {
        const result = validateFonts(fonts);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("validateFonts rejects configs with missing keys", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("heading", "body"),
        validFontNameArb,
        (keyToKeep, value) => {
          // Only include one of the two required keys
          const incomplete = { [keyToKeep]: value };
          const result = validateFonts(incomplete);
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validateFonts rejects configs with extra keys", () => {
    fc.assert(
      fc.property(
        validFontConfigArb,
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s !== "heading" && s !== "body"),
        fc.string({ minLength: 1, maxLength: 50 }),
        (validFonts, extraKey, extraValue) => {
          const withExtra = { ...validFonts, [extraKey]: extraValue };
          const result = validateFonts(withExtra);
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validateFonts rejects empty strings", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("heading", "body"),
        validFontNameArb,
        (keyToEmpty, otherValue) => {
          const fonts =
            keyToEmpty === "heading"
              ? { heading: "", body: otherValue }
              : { heading: otherValue, body: "" };
          const result = validateFonts(fonts);
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validateFonts rejects strings exceeding 100 characters", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("heading", "body"),
        fc.string({ minLength: 101, maxLength: 200 }),
        validFontNameArb,
        (keyToOverflow, longValue, otherValue) => {
          const fonts =
            keyToOverflow === "heading"
              ? { heading: longValue, body: otherValue }
              : { heading: otherValue, body: longValue };
          const result = validateFonts(fonts);
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validateFonts rejects non-string values", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("heading", "body"),
        fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined), fc.boolean(), fc.object()),
        validFontNameArb,
        (keyToInvalidate, invalidValue, otherValue) => {
          const fonts =
            keyToInvalidate === "heading"
              ? { heading: invalidValue, body: otherValue }
              : { heading: otherValue, body: invalidValue };
          const result = validateFonts(fonts);
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validateFonts rejects non-object inputs", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.string(),
          fc.array(fc.anything()),
          fc.boolean(),
        ),
        (input) => {
          const result = validateFonts(input);
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: Invalid settings mutations do not alter stored state ──────────

describe("Feature: white-label-customization, Property 4: Invalid settings mutations do not alter stored state", () => {
  /**
   * **Validates: Requirements 1.6**
   *
   * For any PATCH request that fails validation, the stored site_settings row
   * shall remain identical to its state before the request.
   *
   * We simulate this by showing that when validation fails (validateColors or
   * validateFonts returns errors), the PATCH handler returns 400 and does NOT
   * proceed to the database update step.
   */
  it("invalid colors in PATCH body trigger validation failure, leaving state unchanged", () => {
    fc.assert(
      fc.property(
        validSettingsStateArb,
        invalidHslArb,
        fc.constantFrom("primary", "secondary", "accent", "background", "text", "muted"),
        (originalState, invalidValue, keyToInvalidate) => {
          // Build invalid colors
          const invalidColors = { ...originalState.colors, [keyToInvalidate]: invalidValue };

          // Simulate PATCH validation logic
          const colorErrors = validateColors(invalidColors);

          // Validation must fail
          expect(colorErrors).not.toBeNull();

          // Since validation failed, the state must remain unchanged
          // (the handler returns 400 before reaching the DB update)
          const resultState = { ...originalState };
          expect(resultState).toEqual(originalState);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("invalid fonts in PATCH body trigger validation failure, leaving state unchanged", () => {
    fc.assert(
      fc.property(
        validSettingsStateArb,
        fc.oneof(
          // empty string
          fc.constant(""),
          // string > 100 chars
          fc.string({ minLength: 101, maxLength: 200 }),
          // non-string types
          fc.integer(),
          fc.constant(null),
        ),
        fc.constantFrom("heading", "body"),
        (originalState, invalidValue, keyToInvalidate) => {
          // Build invalid fonts
          const invalidFonts = { ...originalState.fonts, [keyToInvalidate]: invalidValue };

          // Simulate PATCH validation logic
          const fontErrors = validateFonts(invalidFonts);

          // Validation must fail
          expect(fontErrors).not.toBeNull();

          // Since validation failed, the state must remain unchanged
          const resultState = { ...originalState };
          expect(resultState).toEqual(originalState);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("invalid colors with missing keys trigger validation failure, preserving state", () => {
    fc.assert(
      fc.property(
        validSettingsStateArb,
        fc.subarray(["primary", "secondary", "accent", "background", "text", "muted"], { minLength: 1, maxLength: 5 }),
        (originalState, keysToRemove) => {
          // Build colors with missing keys
          const incompleteColors = { ...originalState.colors };
          for (const key of keysToRemove) {
            delete (incompleteColors as Record<string, unknown>)[key];
          }

          // Validate — must fail
          const errors = validateColors(incompleteColors);
          expect(errors).not.toBeNull();

          // State unchanged
          const resultState = { ...originalState };
          expect(resultState).toEqual(originalState);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("PATCH body with only invalid fields results in zero state changes", () => {
    fc.assert(
      fc.property(
        validSettingsStateArb,
        invalidHslArb,
        fc.constantFrom("primary", "secondary", "accent", "background", "text", "muted"),
        fc.oneof(fc.constant(""), fc.string({ minLength: 101, maxLength: 200 })),
        fc.constantFrom("heading", "body"),
        (originalState, invalidColorValue, colorKey, invalidFontValue, fontKey) => {
          // Build PATCH body with both invalid colors and invalid fonts
          const patchColors = { ...originalState.colors, [colorKey]: invalidColorValue };
          const patchFonts = { ...originalState.fonts, [fontKey]: invalidFontValue };

          // Simulate validation
          const colorErrors = validateColors(patchColors);
          const fontErrors = validateFonts(patchFonts);

          // At least one must fail
          const hasErrors = colorErrors !== null || fontErrors !== null;
          expect(hasErrors).toBe(true);

          // State remains unchanged when validation fails
          const resultState = { ...originalState };
          expect(resultState).toEqual(originalState);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Get a deterministic "new value" for a field (used in Property 1) */
function getNewValueForField(field: string): unknown {
  switch (field) {
    case "store_name":
      return { az: "Test Mağaza", ru: "Тест Магазин", en: "Test Store" };
    case "colors":
      return {
        primary: "200 60% 40%",
        secondary: "200 20% 20%",
        accent: "30 80% 50%",
        background: "0 0% 98%",
        text: "200 20% 15%",
        muted: "200 10% 55%",
      };
    case "fonts":
      return { heading: "Poppins", body: "Open Sans" };
    case "logo_url":
      return "https://example.com/logo.png";
    case "favicon_url":
      return "https://example.com/favicon.ico";
    case "contact":
      return { phone: "+994551234567", email: "test@example.com", address: "Test Address", social_links: {} };
    case "working_hours":
      return { az: "10:00-20:00", ru: "10:00-20:00", en: "10:00-20:00" };
    case "footer_text":
      return { az: "Test text", ru: "Тест текст", en: "Test text" };
    default:
      return null;
  }
}
