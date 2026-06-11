/**
 * ThemeEngine — Pure module (no React) that applies color palette and font
 * selections as CSS custom properties on :root at runtime.
 *
 * Requirements: 3.1, 3.3, 3.6
 */

import type { ColorPalette, FontConfig } from "./context";

// ─── HSL Validation ──────────────────────────────────────────────────────────

/**
 * Parses an HSL string in the format "H S% L%" and validates ranges.
 * Returns true if the HSL value is valid:
 *   - Hue: 0–360
 *   - Saturation: 0–100 (%)
 *   - Lightness: 0–100 (%)
 */
export function isValidHsl(value: string): boolean {
  if (!value || typeof value !== "string") return false;

  // Expected format: "H S% L%" e.g. "220 70% 50%"
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match) return false;

  const hue = parseFloat(match[1]);
  const saturation = parseFloat(match[2]);
  const lightness = parseFloat(match[3]);

  if (hue < 0 || hue > 360) return false;
  if (saturation < 0 || saturation > 100) return false;
  if (lightness < 0 || lightness > 100) return false;

  return true;
}

// ─── CSS Custom Property Mapping ─────────────────────────────────────────────

/**
 * Maps ColorPalette keys to CSS custom property names.
 * Note: the settings key "text" maps to CSS var "--foreground".
 */
const COLOR_TO_CSS_VAR: Record<keyof ColorPalette, string> = {
  primary: "--primary",
  secondary: "--secondary",
  accent: "--accent",
  background: "--background",
  text: "--foreground",
  muted: "--muted",
};

// ─── Apply Theme Colors ──────────────────────────────────────────────────────

/**
 * Validates and applies color palette values as CSS custom properties on :root.
 * If validation fails for a specific color, that CSS property retains its
 * previous value (is not updated).
 */
export function applyColors(colors: ColorPalette): void {
  const root = document.documentElement;

  for (const [key, cssVar] of Object.entries(COLOR_TO_CSS_VAR)) {
    const hslValue = colors[key as keyof ColorPalette];
    if (isValidHsl(hslValue)) {
      root.style.setProperty(cssVar, hslValue);
    }
    // If invalid, retain previous value — do nothing
  }
}

// ─── Apply Theme Fonts ───────────────────────────────────────────────────────

/**
 * Applies font family selections as CSS custom properties on :root.
 * Sets --app-font-sans (body font) and --app-font-serif (heading font).
 */
export function applyFonts(fonts: FontConfig): void {
  const root = document.documentElement;

  if (fonts.body && typeof fonts.body === "string" && fonts.body.trim()) {
    root.style.setProperty("--app-font-sans", `"${fonts.body}", sans-serif`);
  }

  if (fonts.heading && typeof fonts.heading === "string" && fonts.heading.trim()) {
    root.style.setProperty("--app-font-serif", `"${fonts.heading}", serif`);
  }
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Applies the full theme (colors + fonts) without triggering a full page reload.
 * Validates HSL ranges before applying — invalid colors are skipped.
 * Designed to complete within 100ms of receiving data.
 *
 * @param colors - The color palette from site settings
 * @param fonts - The font configuration from site settings
 */
export function applyTheme(colors: ColorPalette, fonts: FontConfig): void {
  applyColors(colors);
  applyFonts(fonts);
}
