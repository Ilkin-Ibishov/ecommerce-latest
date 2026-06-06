import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";

// ─── Field components ─────────────────────────────────────────────────────────
function TextField({ label, value, onChange, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function NumberField({ label, value, onChange, min = 0, hint }: {
  label: string; value: string; onChange: (v: string) => void; min?: number; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
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

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    adminFetch(apiUrl("/admin/settings"))
      .then((r) => r.ok ? r.json() : {})
      .then((data) => { setSettings(data); setLoading(false); });
  }, []);

  const set = (key: string, value: string) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true); setError("");
    const res = await adminFetch(apiUrl("/admin/settings"), {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to save settings");
    }
    setSaving(false);
  };

  if (loading) return <div className="text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save All Changes"}
        </button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      {/* Delivery */}
      <Section title="Delivery">
        <NumberField
          label="Free delivery threshold (AZN)"
          value={settings.free_delivery_threshold ?? "100"}
          onChange={(v) => set("free_delivery_threshold", v)}
          hint="Orders at or above this amount qualify for free delivery"
        />
      </Section>

      {/* Product Display */}
      <Section title="Product Display">
        <div className="grid sm:grid-cols-2 gap-4">
          <NumberField
            label="Installment months"
            value={settings.installment_months ?? "12"}
            onChange={(v) => set("installment_months", v)}
            min={1}
            hint="Shown on product cards and detail pages"
          />
          <NumberField
            label="Low stock alert threshold (units)"
            value={settings.low_stock_threshold ?? "10"}
            onChange={(v) => set("low_stock_threshold", v)}
            min={1}
            hint="Products below this show in the dashboard alert"
          />
        </div>
      </Section>

      {/* Announcement Bar */}
      <Section title="Announcement Bar">
        <TextField
          label="Message (Azerbaijani)"
          value={settings.announcement_message_az ?? ""}
          onChange={(v) => set("announcement_message_az", v)}
          placeholder="100 AZN-dən yuxarı sifarişlərə Pulsuz Çatdırılma…"
        />
        <TextField
          label="Message (Russian)"
          value={settings.announcement_message_ru ?? ""}
          onChange={(v) => set("announcement_message_ru", v)}
          placeholder="Бесплатная доставка для заказов от 100 AZN…"
        />
        <TextField
          label="Message (English)"
          value={settings.announcement_message_en ?? ""}
          onChange={(v) => set("announcement_message_en", v)}
          placeholder="Free Delivery on orders over 100 AZN…"
        />
      </Section>

      {/* Contact */}
      <Section title="Contact Information">
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField
            label="Phone"
            value={settings.contact_phone ?? ""}
            onChange={(v) => set("contact_phone", v)}
            placeholder="+994 XX XXX XX XX"
          />
          <TextField
            label="Email"
            value={settings.contact_email ?? ""}
            onChange={(v) => set("contact_email", v)}
            placeholder="info@example.com"
          />
        </div>
        <TextField
          label="City / Address"
          value={settings.contact_city ?? ""}
          onChange={(v) => set("contact_city", v)}
          placeholder="Bakı, Azərbaycan"
        />
      </Section>

      {/* Social Links */}
      <Section title="Social Links">
        <TextField
          label="Instagram URL"
          value={settings.instagram_url ?? ""}
          onChange={(v) => set("instagram_url", v)}
          placeholder="https://instagram.com/yourpage"
        />
        <TextField
          label="Facebook URL"
          value={settings.facebook_url ?? ""}
          onChange={(v) => set("facebook_url", v)}
          placeholder="https://facebook.com/yourpage"
        />
        <TextField
          label="Telegram URL"
          value={settings.telegram_url ?? ""}
          onChange={(v) => set("telegram_url", v)}
          placeholder="https://t.me/yourchannel"
        />
      </Section>

      {/* Save again at bottom for long page */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save All Changes"}
        </button>
      </div>
    </div>
  );
}
