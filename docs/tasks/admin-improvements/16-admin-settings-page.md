# Task 16 — Admin Settings Page

**Priority:** P3  
**Effort:** ~6h  
**New files:** `artifacts/store/src/pages/admin/SettingsPage.tsx`  
**New DB table:** `store_settings`  
**New API route:** `GET/PATCH /admin/settings`

---

## Problem

Several values are currently hardcoded in the codebase and require a code change + redeployment to update:

| Setting | Current location | Hardcoded value |
|---------|-----------------|-----------------|
| Free delivery threshold | `AnnouncementBar.tsx`, `CartDrawer.tsx` | 100 AZN |
| Free delivery minimum for product page | `ProductDetail.tsx` | 50 AZN |
| Store name | `AdminLayout.tsx`, `<title>` | `İlk Electronics` (from env) |
| Installment months | `ProductDetail.tsx`, `ProductCard.tsx` | 12 months |
| Low stock threshold | Dashboard (after Task 03) | 10 units |
| Social links (Instagram, Facebook, Telegram) | `Footer.tsx` | Hardcoded URLs |
| Contact info (phone, email, city) | `Footer.tsx` | Hardcoded strings |

---

## Implementation Plan

### 1. Create the `store_settings` database table

**Supabase migration:**

```sql
CREATE TABLE IF NOT EXISTS store_settings (
  key   text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);

-- Seed default values
INSERT INTO store_settings (key, value, description) VALUES
  ('free_delivery_threshold', '100', 'Minimum order total (AZN) for free delivery'),
  ('low_stock_threshold', '10', 'Products with stock below this appear in the low stock alert'),
  ('installment_months', '12', 'Number of installment months shown on product pages'),
  ('store_name', 'İlk Electronics', 'Store display name'),
  ('contact_phone', '+994 55 619 59 07', 'Contact phone shown in footer'),
  ('contact_email', 'info@ilkelectronics.com', 'Contact email shown in footer'),
  ('contact_city', 'Bakı, Azərbaycan', 'Contact address shown in footer'),
  ('instagram_url', 'https://instagram.com', 'Instagram profile URL'),
  ('facebook_url', 'https://facebook.com', 'Facebook page URL'),
  ('telegram_url', 'https://t.me', 'Telegram channel URL'),
  ('announcement_message_az', '100 AZN-dən yuxarı sifarişlərə Pulsuz Çatdırılma · Bütün Azərbaycan üzrə', 'Announcement bar text (Azerbaijani)'),
  ('announcement_message_ru', 'Бесплатная доставка для заказов от 100 AZN · По всему Азербайджану', 'Announcement bar text (Russian)'),
  ('announcement_message_en', 'Free Delivery on orders over 100 AZN · Across all Azerbaijan', 'Announcement bar text (English)')
ON CONFLICT (key) DO NOTHING;

-- RLS: admins can read/write, anon can only read (for storefront)
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON store_settings FOR SELECT USING (true);
CREATE POLICY "Admin write" ON store_settings FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);
```

### 2. Backend endpoints

**File:** `artifacts/api-server/src/routes/admin.ts`

```typescript
// GET all settings
router.get("/admin/settings", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const { data } = await (ctx.admin as any)
    .from("store_settings")
    .select("key, value, description")
    .order("key");

  // Return as a flat key→value map for easy use
  const settings: Record<string, string> = {};
  (data ?? []).forEach((row: any) => { settings[row.key] = row.value; });

  res.json(settings);
});

// PATCH multiple settings at once
router.patch("/admin/settings", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const updates = req.body as Record<string, string>;
  if (!updates || typeof updates !== "object") {
    res.status(400).json({ error: "Body must be a key-value object" });
    return;
  }

  // Upsert each setting
  const rows = Object.entries(updates).map(([key, value]) => ({
    key,
    value: String(value),
    updated_at: new Date().toISOString(),
  }));

  await (ctx.admin as any)
    .from("store_settings")
    .upsert(rows, { onConflict: "key" });

  await (ctx.admin as any).from("audit_log").insert({
    actor_id: ctx.user.id, action: "update_settings",
    entity: "store_settings", entity_id: null,
    changes: updates,
  });

  res.json({ success: true });
});
```

### 3. Create `SettingsPage.tsx`

Grouped into sections for clarity:

```tsx
export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch(apiUrl("/admin/settings"))
      .then((r) => r.json())
      .then((data) => { setSettings(data); setLoading(false); });
  }, []);

  const set = (key: string, value: string) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    await adminFetch(apiUrl("/admin/settings"), {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Changes"}
        </button>
      </div>

      {/* Store identity */}
      <Section title="Store">
        <Field label="Store Name" value={settings.store_name ?? ""} onChange={(v) => set("store_name", v)} />
      </Section>

      {/* Delivery */}
      <Section title="Delivery">
        <NumberField label="Free delivery threshold (AZN)" value={settings.free_delivery_threshold ?? "100"} onChange={(v) => set("free_delivery_threshold", v)} />
      </Section>

      {/* Product display */}
      <Section title="Product Display">
        <NumberField label="Installment months" value={settings.installment_months ?? "12"} onChange={(v) => set("installment_months", v)} />
        <NumberField label="Low stock alert threshold (units)" value={settings.low_stock_threshold ?? "10"} onChange={(v) => set("low_stock_threshold", v)} />
      </Section>

      {/* Announcement bar */}
      <Section title="Announcement Bar">
        <Field label="Message (Azerbaijani)" value={settings.announcement_message_az ?? ""} onChange={(v) => set("announcement_message_az", v)} />
        <Field label="Message (Russian)" value={settings.announcement_message_ru ?? ""} onChange={(v) => set("announcement_message_ru", v)} />
        <Field label="Message (English)" value={settings.announcement_message_en ?? ""} onChange={(v) => set("announcement_message_en", v)} />
      </Section>

      {/* Contact */}
      <Section title="Contact Information">
        <Field label="Phone" value={settings.contact_phone ?? ""} onChange={(v) => set("contact_phone", v)} />
        <Field label="Email" value={settings.contact_email ?? ""} onChange={(v) => set("contact_email", v)} />
        <Field label="City/Address" value={settings.contact_city ?? ""} onChange={(v) => set("contact_city", v)} />
      </Section>

      {/* Social links */}
      <Section title="Social Links">
        <Field label="Instagram URL" value={settings.instagram_url ?? ""} onChange={(v) => set("instagram_url", v)} placeholder="https://instagram.com/yourpage" />
        <Field label="Facebook URL" value={settings.facebook_url ?? ""} onChange={(v) => set("facebook_url", v)} placeholder="https://facebook.com/yourpage" />
        <Field label="Telegram URL" value={settings.telegram_url ?? ""} onChange={(v) => set("telegram_url", v)} placeholder="https://t.me/yourchannel" />
      </Section>
    </div>
  );
}
```

### 4. Create a settings context for the storefront

To avoid each component fetching settings independently, create a lightweight context:

**New file:** `artifacts/store/src/lib/settings/context.tsx`

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

interface StoreSettings {
  free_delivery_threshold: number;
  low_stock_threshold: number;
  installment_months: number;
  contact_phone: string;
  contact_email: string;
  contact_city: string;
  instagram_url: string;
  facebook_url: string;
  telegram_url: string;
  announcement_message_az: string;
  announcement_message_ru: string;
  announcement_message_en: string;
}

// Sensible defaults — used while loading or if DB is unreachable
const DEFAULTS: StoreSettings = {
  free_delivery_threshold: 100,
  low_stock_threshold: 10,
  installment_months: 12,
  contact_phone: "+994 55 619 59 07",
  contact_email: "info@ilkelectronics.com",
  contact_city: "Bakı, Azərbaycan",
  instagram_url: "https://instagram.com",
  facebook_url: "https://facebook.com",
  telegram_url: "https://t.me",
  announcement_message_az: "100 AZN-dən yuxarı sifarişlərə Pulsuz Çatdırılma · Bütün Azərbaycan üzrə",
  announcement_message_ru: "Бесплатная доставка для заказов от 100 AZN",
  announcement_message_en: "Free Delivery on orders over 100 AZN",
};

const SettingsContext = createContext<StoreSettings>(DEFAULTS);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StoreSettings>(DEFAULTS);

  useEffect(() => {
    const supabase = createClient();
    (supabase as any)
      .from("store_settings")
      .select("key, value")
      .then(({ data }: any) => {
        if (!data) return;
        const map: Record<string, string> = {};
        data.forEach((row: any) => { map[row.key] = row.value; });
        setSettings({
          free_delivery_threshold: Number(map.free_delivery_threshold ?? 100),
          low_stock_threshold: Number(map.low_stock_threshold ?? 10),
          installment_months: Number(map.installment_months ?? 12),
          contact_phone: map.contact_phone ?? DEFAULTS.contact_phone,
          contact_email: map.contact_email ?? DEFAULTS.contact_email,
          contact_city: map.contact_city ?? DEFAULTS.contact_city,
          instagram_url: map.instagram_url ?? DEFAULTS.instagram_url,
          facebook_url: map.facebook_url ?? DEFAULTS.facebook_url,
          telegram_url: map.telegram_url ?? DEFAULTS.telegram_url,
          announcement_message_az: map.announcement_message_az ?? DEFAULTS.announcement_message_az,
          announcement_message_ru: map.announcement_message_ru ?? DEFAULTS.announcement_message_ru,
          announcement_message_en: map.announcement_message_en ?? DEFAULTS.announcement_message_en,
        });
      });
  }, []);

  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}
```

### 5. Wire `SettingsProvider` into `App.tsx`

```tsx
// Wrap alongside CartProvider and I18nProvider:
<SettingsProvider>
  <CartProvider>
    <I18nProvider>
      ...
    </I18nProvider>
  </CartProvider>
</SettingsProvider>
```

### 6. Replace hardcoded values in storefront components

After the context is in place, update:

| Component | Hardcoded value | Replace with |
|-----------|----------------|--------------|
| `AnnouncementBar.tsx` | `"100 AZN-dən yuxarı…"` | `settings.announcement_message_{locale}` |
| `CartDrawer.tsx` | `100` (free delivery) | `settings.free_delivery_threshold` |
| `ProductDetail.tsx` | `50` (free delivery) and `12` (months) | `settings.free_delivery_threshold`, `settings.installment_months` |
| `ProductCard.tsx` | `12` (months) | `settings.installment_months` |
| `Footer.tsx` | Contact info + social links | `settings.contact_*`, `settings.*_url` |
| `DashboardPage.tsx` | `10` (low stock) | `settings.low_stock_threshold` |

### 7. Add to AdminLayout nav + App.tsx

```tsx
// AdminLayout navItems — at the bottom, before sign out:
{ href: "/admin/settings", label: "Settings", icon: Settings2 },

// App.tsx:
<Route path="/admin/settings" component={AdminSettingsPage} />
```

---

## Migration Required

Run in Supabase SQL editor or via `mcp_supabase_apply_migration`:

```sql
CREATE TABLE IF NOT EXISTS store_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);
-- (plus seed data and RLS policies — see Step 1 above)
```

---

## Files Changed
- `artifacts/store/src/pages/admin/SettingsPage.tsx` — new file
- `artifacts/store/src/lib/settings/context.tsx` — new settings context
- `artifacts/store/src/App.tsx` — wrap with SettingsProvider, register route
- `artifacts/store/src/pages/admin/AdminLayout.tsx` — add Settings nav item
- `artifacts/api-server/src/routes/admin.ts` — `GET/PATCH /admin/settings`
- `artifacts/store/src/components/storefront/AnnouncementBar.tsx` — use settings
- `artifacts/store/src/components/storefront/CartDrawer.tsx` — use settings
- `artifacts/store/src/components/storefront/ProductDetail.tsx` — use settings
- `artifacts/store/src/components/storefront/ProductCard.tsx` — use settings
- `artifacts/store/src/components/storefront/Footer.tsx` — use settings
- Supabase — new `store_settings` table + seed data
