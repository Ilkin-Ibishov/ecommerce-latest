/**
 * Unit tests for ThemeEngine module.
 *
 * Tests HSL validation, color application, font application, and the combined
 * applyTheme function. Uses a minimal DOM mock since tests run in node env.
 *
 * Validates: Requirements 3.1, 3.3, 3.6
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { isValidHsl, applyColors, applyFonts, applyTheme } from "./theme-engine";
import type { ColorPalette, FontConfig } from "./context";

// ─── DOM Mock ────────────────────────────────────────────────────────────────

const styleProps = new Map<string, string>();
const mockStyle = {
  setProperty: vi.fn((name: string, value: string) => {
    styleProps.set(name, value);
  }),
};

beforeEach(() => {
  styleProps.clear();
  mockStyle.setProperty.mockClear();

  // Mock document.documentElement
  Object.defineProperty(global, "document", {
    value: {
      documentElement: {
        style: mockStyle,
      },
    },
    writable: true,
    configurable: true,
  });
});

// ─── isValidHsl Tests ────────────────────────────────────────────────────────

describe("isValidHsl", () => {
  it("accepts valid HSL strings", () => {
    expect(isValidHsl("220 70% 50%")).toBe(true);
    expect(isValidHsl("0 0% 0%")).toBe(true);
    expect(isValidHsl("360 100% 100%")).toBe(true);
    expect(isValidHsl("45 93% 47%")).toBe(true);
  });

  it("accepts decimal values within range", () => {
    expect(isValidHsl("220.5 70.5% 50.5%")).toBe(true);
    expect(isValidHsl("0.1 0.1% 0.1%")).toBe(true);
  });

  it("rejects hue outside 0-360", () => {
    expect(isValidHsl("361 70% 50%")).toBe(false);
    expect(isValidHsl("400 70% 50%")).toBe(false);
  });

  it("rejects saturation outside 0-100", () => {
    expect(isValidHsl("220 101% 50%")).toBe(false);
    expect(isValidHsl("220 150% 50%")).toBe(false);
  });

  it("rejects lightness outside 0-100", () => {
    expect(isValidHsl("220 70% 101%")).toBe(false);
    expect(isValidHsl("220 70% 200%")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isValidHsl("")).toBe(false);
    expect(isValidHsl("red")).toBe(false);
    expect(isValidHsl("220 70 50")).toBe(false); // missing % signs
    expect(isValidHsl("220 70% 50")).toBe(false); // missing last %
    expect(isValidHsl("hsl(220, 70%, 50%)")).toBe(false); // CSS function format
    expect(isValidHsl("220,70%,50%")).toBe(false); // comma separated
  });

  it("rejects null/undefined/non-string values", () => {
    expect(isValidHsl(null as unknown as string)).toBe(false);
    expect(isValidHsl(undefined as unknown as string)).toBe(false);
    expect(isValidHsl(123 as unknown as string)).toBe(false);
  });
});

// ─── applyColors Tests ───────────────────────────────────────────────────────

describe("applyColors", () => {
  const validPalette: ColorPalette = {
    primary: "220 70% 50%",
    secondary: "220 20% 20%",
    accent: "45 93% 47%",
    background: "0 0% 100%",
    text: "220 20% 10%",
    muted: "220 10% 60%",
  };

  it("sets all CSS custom properties for a valid palette", () => {
    applyColors(validPalette);

    expect(styleProps.get("--primary")).toBe("220 70% 50%");
    expect(styleProps.get("--secondary")).toBe("220 20% 20%");
    expect(styleProps.get("--accent")).toBe("45 93% 47%");
    expect(styleProps.get("--background")).toBe("0 0% 100%");
    expect(styleProps.get("--foreground")).toBe("220 20% 10%"); // text → --foreground
    expect(styleProps.get("--muted")).toBe("220 10% 60%");
  });

  it("skips invalid colors without affecting valid ones", () => {
    const partiallyInvalid: ColorPalette = {
      primary: "220 70% 50%",
      secondary: "999 20% 20%", // invalid hue
      accent: "45 93% 47%",
      background: "0 0% 100%",
      text: "220 200% 10%", // invalid saturation
      muted: "220 10% 60%",
    };

    applyColors(partiallyInvalid);

    expect(styleProps.get("--primary")).toBe("220 70% 50%");
    expect(styleProps.has("--secondary")).toBe(false); // skipped
    expect(styleProps.get("--accent")).toBe("45 93% 47%");
    expect(styleProps.get("--background")).toBe("0 0% 100%");
    expect(styleProps.has("--foreground")).toBe(false); // skipped
    expect(styleProps.get("--muted")).toBe("220 10% 60%");
  });

  it("does not call setProperty for invalid colors", () => {
    const allInvalid: ColorPalette = {
      primary: "invalid",
      secondary: "also-invalid",
      accent: "",
      background: "999 999% 999%",
      text: "hsl(220, 70%, 50%)",
      muted: "not-hsl",
    };

    applyColors(allInvalid);

    expect(mockStyle.setProperty).not.toHaveBeenCalled();
  });
});

// ─── applyFonts Tests ────────────────────────────────────────────────────────

describe("applyFonts", () => {
  it("sets font CSS custom properties for valid fonts", () => {
    const fonts: FontConfig = { heading: "Playfair Display", body: "Inter" };
    applyFonts(fonts);

    expect(styleProps.get("--app-font-sans")).toBe('"Inter", sans-serif');
    expect(styleProps.get("--app-font-serif")).toBe('"Playfair Display", serif');
  });

  it("skips empty font values", () => {
    const fonts: FontConfig = { heading: "", body: "" };
    applyFonts(fonts);

    expect(mockStyle.setProperty).not.toHaveBeenCalled();
  });

  it("skips whitespace-only font values", () => {
    const fonts: FontConfig = { heading: "   ", body: "   " };
    applyFonts(fonts);

    expect(mockStyle.setProperty).not.toHaveBeenCalled();
  });
});

// ─── applyTheme Tests ────────────────────────────────────────────────────────

describe("applyTheme", () => {
  it("applies both colors and fonts in one call", () => {
    const colors: ColorPalette = {
      primary: "220 70% 50%",
      secondary: "220 20% 20%",
      accent: "45 93% 47%",
      background: "0 0% 100%",
      text: "220 20% 10%",
      muted: "220 10% 60%",
    };
    const fonts: FontConfig = { heading: "Georgia", body: "Roboto" };

    applyTheme(colors, fonts);

    // Colors applied
    expect(styleProps.get("--primary")).toBe("220 70% 50%");
    expect(styleProps.get("--foreground")).toBe("220 20% 10%");
    // Fonts applied
    expect(styleProps.get("--app-font-sans")).toBe('"Roboto", sans-serif');
    expect(styleProps.get("--app-font-serif")).toBe('"Georgia", serif');
  });

  it("applies valid colors even when fonts are empty", () => {
    const colors: ColorPalette = {
      primary: "180 50% 50%",
      secondary: "200 30% 30%",
      accent: "60 80% 50%",
      background: "0 0% 100%",
      text: "0 0% 0%",
      muted: "0 0% 50%",
    };
    const fonts: FontConfig = { heading: "", body: "" };

    applyTheme(colors, fonts);

    expect(styleProps.get("--primary")).toBe("180 50% 50%");
    expect(styleProps.has("--app-font-sans")).toBe(false);
    expect(styleProps.has("--app-font-serif")).toBe(false);
  });
});
