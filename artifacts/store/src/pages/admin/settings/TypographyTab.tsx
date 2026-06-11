import { useEffect, useRef } from "react";
import type { SiteSettings, FontConfig } from "@/lib/settings/context";

/**
 * Curated list of popular Google Fonts for the Typography settings tab.
 * Each entry is the font family name used by Google Fonts.
 */
export const GOOGLE_FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Playfair Display",
  "Merriweather",
  "Raleway",
  "Nunito",
  "Source Sans 3",
  "PT Sans",
  "Oswald",
  "Rubik",
  "Work Sans",
  "Noto Sans",
  "Fira Sans",
  "Quicksand",
  "Mulish",
  "Bitter",
] as const;

export type GoogleFontName = (typeof GOOGLE_FONTS)[number];

/**
 * Builds a Google Fonts CSS link URL to load all curated fonts for preview.
 * Uses the display=swap strategy for performance.
 */
export function buildGoogleFontsUrl(fonts: readonly string[]): string {
  const families = fonts
    .map((f) => `family=${f.replace(/\s+/g, "+")}:wght@400;700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

// ─── Font Select Component ───────────────────────────────────────────────────

function FontSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        style={{ fontFamily: value ? `"${value}", sans-serif` : undefined }}
      >
        <option value="">Select a font...</option>
        {GOOGLE_FONTS.map((font) => (
          <option key={font} value={font} style={{ fontFamily: `"${font}", sans-serif` }}>
            {font}
          </option>
        ))}
      </select>
      {value && (
        <p
          className="text-sm text-muted-foreground mt-1"
          style={{ fontFamily: `"${value}", sans-serif` }}
        >
          The quick brown fox jumps over the lazy dog
        </p>
      )}
    </div>
  );
}

// ─── Typography Tab ──────────────────────────────────────────────────────────

interface TypographyTabProps {
  settings: SiteSettings;
  onChange: (updates: Partial<SiteSettings>) => void;
}

export default function TypographyTab({ settings, onChange }: TypographyTabProps) {
  const linkRef = useRef<HTMLLinkElement | null>(null);
  const fonts: FontConfig = settings.fonts ?? { heading: "", body: "" };

  // Inject Google Fonts link on mount to enable font preview in dropdowns
  useEffect(() => {
    const existing = document.querySelector(
      'link[data-typography-preview="true"]'
    ) as HTMLLinkElement | null;

    if (existing) {
      linkRef.current = existing;
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = buildGoogleFontsUrl(GOOGLE_FONTS);
    link.setAttribute("data-typography-preview", "true");
    document.head.appendChild(link);
    linkRef.current = link;
  }, []);

  const updateFont = (key: keyof FontConfig, value: string) => {
    onChange({ fonts: { ...fonts, [key]: value } });
  };

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-5 space-y-6">
        <div>
          <h3 className="font-semibold text-base border-b border-border pb-2">Typography</h3>
          <p className="text-xs text-muted-foreground mt-2">
            Select fonts for headings and body text. Fonts are loaded from Google Fonts.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <FontSelect
            label="Heading Font"
            value={fonts.heading}
            onChange={(v) => updateFont("heading", v)}
          />
          <FontSelect
            label="Body Font"
            value={fonts.body}
            onChange={(v) => updateFont("body", v)}
          />
        </div>

        {/* Preview section */}
        {(fonts.heading || fonts.body) && (
          <div className="border border-border rounded-lg p-4 bg-background space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Preview
            </p>
            {fonts.heading && (
              <h3
                className="text-xl font-bold"
                style={{ fontFamily: `"${fonts.heading}", serif` }}
              >
                Heading in {fonts.heading}
              </h3>
            )}
            {fonts.body && (
              <p
                className="text-sm leading-relaxed"
                style={{ fontFamily: `"${fonts.body}", sans-serif` }}
              >
                Body text in {fonts.body}. This is how your storefront content will appear
                to customers browsing your products and pages.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
