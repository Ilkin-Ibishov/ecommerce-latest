/**
 * Property-based test for ThemeEngine HSL validation.
 *
 * Feature: white-label-customization, Property 7: Theme engine validates HSL ranges before applying
 *
 * Property 7: For any color palette containing an HSL value with hue outside [0, 360]
 * or saturation/lightness outside [0, 100], the ThemeEngine SHALL retain the previously
 * applied CSS custom property values for those colors.
 *
 * **Validates: Requirements 3.6**
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import { isValidHsl, applyColors } from "./theme-engine";
import type { ColorPalette } from "./context";

// ─── DOM Mock ────────────────────────────────────────────────────────────────

let styleProps: Map<string, string>;
let mockSetProperty: ReturnType<typeof vi.fn>;

beforeEach(() => {
  styleProps = new Map<string, string>();
  mockSetProperty = vi.fn((name: string, value: string) => {
    styleProps.set(name, value);
  });

  Object.defineProperty(global, "document", {
    value: {
      documentElement: {
        style: { setProperty: mockSetProperty },
      },
    },
    writable: true,
    configurable: true,
  });
});

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Generate numbers that produce normal decimal string representations.
 * We use integers scaled to one decimal place to avoid scientific notation
 * issues (e.g., 5e-324) that the HSL regex cannot parse.
 */

/** Generates a valid HSL hue value [0, 360] as an integer or one-decimal value */
const validHue = fc.integer({ min: 0, max: 3600 }).map((n) => n / 10);

/** Generates a valid saturation or lightness value [0, 100] as an integer or one-decimal value */
const validPercentage = fc.integer({ min: 0, max: 1000 }).map((n) => n / 10);

/** Generates a valid HSL string in format "H S% L%" */
const validHslString = fc.tuple(validHue, validPercentage, validPercentage).map(
  ([h, s, l]) => `${h} ${s}% ${l}%`
);

/** Generates an invalid hue (outside [0, 360]) — integers for clean representation */
const invalidHue = fc.oneof(
  fc.integer({ min: 3601, max: 99990 }).map((n) => n / 10),  // > 360
  fc.integer({ min: -99990, max: -1 }).map((n) => n / 10)     // < 0
);

/** Generates an invalid percentage (outside [0, 100]) — integers for clean representation */
const invalidPercentage = fc.oneof(
  fc.integer({ min: 1001, max: 99990 }).map((n) => n / 10),  // > 100
  fc.integer({ min: -99990, max: -1 }).map((n) => n / 10)     // < 0
);

/** Generates an HSL string with invalid hue */
const hslWithInvalidHue = fc.tuple(invalidHue, validPercentage, validPercentage).map(
  ([h, s, l]) => `${h} ${s}% ${l}%`
);

/** Generates an HSL string with invalid saturation */
const hslWithInvalidSaturation = fc.tuple(validHue, invalidPercentage, validPercentage).map(
  ([h, s, l]) => `${h} ${s}% ${l}%`
);

/** Generates an HSL string with invalid lightness */
const hslWithInvalidLightness = fc.tuple(validHue, validPercentage, invalidPercentage).map(
  ([h, s, l]) => `${h} ${s}% ${l}%`
);

/** Generates any invalid HSL string (one or more components out of range) */
const invalidHslString = fc.oneof(
  hslWithInvalidHue,
  hslWithInvalidSaturation,
  hslWithInvalidLightness
);

/** Generates a valid ColorPalette */
const validColorPalette: fc.Arbitrary<ColorPalette> = fc
  .tuple(validHslString, validHslString, validHslString, validHslString, validHslString, validHslString)
  .map(([primary, secondary, accent, background, text, muted]) => ({
    primary,
    secondary,
    accent,
    background,
    text,
    muted,
  }));

/** Color palette keys */
const colorKeys: (keyof ColorPalette)[] = ["primary", "secondary", "accent", "background", "text", "muted"];

/** CSS variable names corresponding to color keys */
const cssVarNames: Record<keyof ColorPalette, string> = {
  primary: "--primary",
  secondary: "--secondary",
  accent: "--accent",
  background: "--background",
  text: "--foreground",
  muted: "--muted",
};

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Feature: white-label-customization, Property 7: Theme engine validates HSL ranges before applying", () => {
  it("valid HSL values are always applied to CSS custom properties", () => {
    fc.assert(
      fc.property(validColorPalette, (palette) => {
        styleProps.clear();
        mockSetProperty.mockClear();

        applyColors(palette);

        // All 6 colors should have been applied
        for (const key of colorKeys) {
          const cssVar = cssVarNames[key];
          expect(styleProps.get(cssVar)).toBe(palette[key]);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("invalid HSL values cause ThemeEngine to retain previous CSS custom property values", () => {
    fc.assert(
      fc.property(
        validColorPalette,
        fc.constantFrom(...colorKeys),
        invalidHslString,
        (validPalette, targetKey, invalidValue) => {
          // Step 1: Apply a valid palette to set initial CSS values
          styleProps.clear();
          mockSetProperty.mockClear();
          applyColors(validPalette);

          // Record the value that was set for the target key
          const previousValue = styleProps.get(cssVarNames[targetKey]);
          expect(previousValue).toBe(validPalette[targetKey]);

          // Step 2: Create a new palette with one invalid color
          const invalidPalette: ColorPalette = { ...validPalette, [targetKey]: invalidValue };

          // Clear mock call history (but keep the styleProps map to simulate retained values)
          mockSetProperty.mockClear();

          applyColors(invalidPalette);

          // The invalid key's CSS variable should NOT have been updated
          // (setProperty should not have been called with the invalid key's CSS var)
          const callsForTargetVar = mockSetProperty.mock.calls.filter(
            (call: [string, string]) => call[0] === cssVarNames[targetKey]
          );
          expect(callsForTargetVar).toHaveLength(0);

          // The previously set value should still be in the map (retained)
          expect(styleProps.get(cssVarNames[targetKey])).toBe(previousValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("isValidHsl correctly rejects all out-of-range HSL values", () => {
    fc.assert(
      fc.property(invalidHslString, (hslValue) => {
        expect(isValidHsl(hslValue)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("isValidHsl correctly accepts all in-range HSL values", () => {
    fc.assert(
      fc.property(validHslString, (hslValue) => {
        expect(isValidHsl(hslValue)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
