import { useEffect, useState, useRef } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { hexToHsl, hslToHex } from "@/lib/settings/color-utils";
import type { SiteSettings, ColorPalette } from "@/lib/settings/context";
import TypographyTabComponent from "./settings/TypographyTab";
import IdentityContactTab from "./settings/IdentityContactTab";
import { validateSettings, getFirstErrorField, type ValidationErrors } from "./settings/validate-settings";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "branding" | "identity" | "typography";

// ─── Sub-components ───────────────────────────────────────────────────────────

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      }`}
    >
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h2 className="font-semibold text-base border-b border-border pb-2">{title}</h2>
      {children}
    </div>
  );
}

function ColorPickerField({
  label,
  hexValue,
  onChange,
}: {
  label: string;
  hexValue: string;
  onChange: (hex: string) => void;
}) {
  const isValid = hexValue.length === 0 || /^[0-9a-fA-F]{6}$/.test(hexValue);
  const previewColor = /^[0-9a-fA-F]{6}$/.test(hexValue) ? `#${hexValue}` : "#cccccc";

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium capitalize">{label}</label>
      <div className="flex items-center gap-2">
        <div
          className="w-10 h-10 rounded-lg border border-border flex-shrink-0"
          style={{ backgroundColor: previewColor }}
          aria-label={`${label} color preview`}
        />
        <div className="flex items-center gap-1 flex-1">
          <span className="text-sm text-muted-foreground">#</span>
          <input
            type="text"
            value={hexValue}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6))}
            maxLength={6}
            placeholder="000000"
            className={`w-full px-3 py-2 rounded-lg border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring ${
              !isValid ? "border-destructive" : "border-border"
            } bg-background`}
          />
        </div>
      </div>
      {!isValid && (
        <p className="text-destructive text-xs">Enter a valid 6-digit hex color</p>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("branding");
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const formRef = useRef<HTMLDivElement>(null);

  // Color state (hex values for the UI)
  const [colorHexes, setColorHexes] = useState<Record<keyof ColorPalette, string>>({
    primary: "",
    secondary: "",
    accent: "",
    background: "",
    text: "",
    muted: "",
  });

  useEffect(() => {
    fetch(apiUrl("/site-settings"))
      .then((r) => r.json())
      .then((data: SiteSettings) => {
        setSettings(data);
        // Convert HSL colors to hex for display
        const hexes: Record<string, string> = {};
        for (const [key, hslVal] of Object.entries(data.colors)) {
          hexes[key] = hslToHex(hslVal) || "";
        }
        setColorHexes(hexes as Record<keyof ColorPalette, string>);
      })
      .catch(() => setErrorMsg("Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  const handleColorChange = (key: keyof ColorPalette, hex: string) => {
    setColorHexes((prev) => ({ ...prev, [key]: hex }));
  };

  const handleSettingsChange = (updates: Partial<SiteSettings>) => {
    setSettings((prev) => prev ? { ...prev, ...updates } : prev);
  };

  const handleSave = async () => {
    if (!settings) return;

    // Build updated colors from hex inputs
    const updatedColors: Partial<ColorPalette> = {};
    for (const [key, hex] of Object.entries(colorHexes)) {
      if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        const hsl = hexToHsl(`#${hex}`);
        if (hsl) {
          updatedColors[key as keyof ColorPalette] = hsl;
        }
      }
    }

    const payload: SiteSettings = {
      ...settings,
      colors: { ...settings.colors, ...updatedColors },
    };

    // Client-side validation
    const validationErrors = validateSettings(payload);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      const firstField = getFirstErrorField(validationErrors);
      if (firstField && formRef.current) {
        const el = formRef.current.querySelector(`[data-field="${firstField}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    setErrors({});
    setSaving(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await adminFetch(apiUrl("/site-settings"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        setErrorMsg(err.error || "Save failed");
        return;
      }
      const updated = await res.json();
      setSettings(updated);
      setSuccessMsg("Settings saved successfully");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch {
      setErrorMsg("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" ref={formRef}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Site Settings</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {successMsg && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-2 rounded-lg text-sm">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-2 rounded-lg text-sm">
          {errorMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-2">
        <TabButton active={activeTab === "branding"} label="Branding" onClick={() => setActiveTab("branding")} />
        <TabButton active={activeTab === "identity"} label="Identity & Contact" onClick={() => setActiveTab("identity")} />
        <TabButton active={activeTab === "typography"} label="Typography" onClick={() => setActiveTab("typography")} />
      </div>

      {/* Branding Tab */}
      {activeTab === "branding" && settings && (
        <div className="space-y-6">
          <Section title="Color Palette">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(Object.keys(colorHexes) as Array<keyof ColorPalette>).map((key) => (
                <ColorPickerField
                  key={key}
                  label={key}
                  hexValue={colorHexes[key]}
                  onChange={(hex) => handleColorChange(key, hex)}
                />
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* Identity & Contact Tab */}
      {activeTab === "identity" && settings && (
        <IdentityContactTab
          settings={settings}
          onChange={handleSettingsChange}
          errors={errors}
        />
      )}

      {/* Typography Tab */}
      {activeTab === "typography" && settings && (
        <TypographyTabComponent
          settings={settings}
          onChange={handleSettingsChange}
        />
      )}
    </div>
  );
}
