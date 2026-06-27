import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { useI18n } from "@/lib/i18n/context";

interface Coupon {
  id: string; code: string; description: string | null;
  discount_type: "percentage" | "fixed"; discount_value: number;
  min_order_amount: number | null; max_uses: number | null;
  used_count: number; is_active: boolean; expires_at: string | null;
}

const EMPTY = { code: "", description: "", discount_type: "percentage" as "percentage" | "fixed", discount_value: 10, min_order_amount: null as number | null, max_uses: null as number | null, is_active: true, expires_at: null as string | null };

export default function AdminCouponsPage() {
  const { t } = useI18n();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminFetch(apiUrl("/admin/coupons"))
      .then((r) => r.json())
      .then((data) => setCoupons(data ?? []));
  }, []);

  const openNew = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
  const openEdit = (c: Coupon) => {
    setEditing(c);
    setForm({ code: c.code, description: c.description ?? "", discount_type: c.discount_type, discount_value: c.discount_value, min_order_amount: c.min_order_amount, max_uses: c.max_uses, is_active: c.is_active, expires_at: c.expires_at ? c.expires_at.split("T")[0] : null });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.code.trim()) return;
    setSaving(true);
    const body = { ...form, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null };
    if (editing) {
      await adminFetch(apiUrl(`/admin/coupons/${editing.id}`), { method: "PATCH", body: JSON.stringify(body) });
      setCoupons((prev) => prev.map((c) => c.id === editing.id ? { ...c, ...form } : c));
    } else {
      const res = await adminFetch(apiUrl("/admin/coupons"), { method: "POST", body: JSON.stringify(body) });
      const data = await res.json();
      if (data.id) setCoupons((prev) => [{ id: data.id, used_count: 0, ...form } as Coupon, ...prev]);
    }
    setSaving(false); setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    await adminFetch(apiUrl(`/admin/coupons/${id}`), { method: "DELETE" });
    setCoupons((prev) => prev.filter((c) => c.id !== id));
  };

  const toggleActive = async (c: Coupon) => {
    await adminFetch(apiUrl(`/admin/coupons/${c.id}`), { method: "PATCH", body: JSON.stringify({ ...c, is_active: !c.is_active }) });
    setCoupons((prev) => prev.map((x) => x.id === c.id ? { ...x, is_active: !x.is_active } : x));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("Admin.Coupons.title")}</h1>
      <button onClick={openNew} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition">
        <Plus size={16} /> {t("Admin.Coupons.newCoupon")}
      </button>

      {showForm && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{editing ? t("Admin.Coupons.editCoupon") : t("Admin.Coupons.newCoupon")}</h3>
            <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <F label={t("Admin.Coupons.labelCode")} value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))} placeholder={t("Admin.Coupons.placeholderCode")} />
            <F label={t("Admin.Coupons.labelDescription")} value={form.description ?? ""} onChange={(v) => setForm((f) => ({ ...f, description: v }))} placeholder={t("Admin.Coupons.placeholderDescription")} />
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t("Admin.Coupons.labelType")}</label>
              <select value={form.discount_type} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value as any }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="percentage">{t("Admin.Coupons.typePercentage")}</option>
                <option value="fixed">{t("Admin.Coupons.typeFixed")}</option>
              </select>
            </div>
            <N label={form.discount_type === "percentage" ? t("Admin.Coupons.labelDiscountPercent") : t("Admin.Coupons.labelDiscountFixed")} value={form.discount_value} onChange={(v) => setForm((f) => ({ ...f, discount_value: v }))} />
            <N label={t("Admin.Coupons.labelMinOrder")} value={form.min_order_amount ?? 0} onChange={(v) => setForm((f) => ({ ...f, min_order_amount: v || null }))} />
            <N label={t("Admin.Coupons.labelMaxUses")} value={form.max_uses ?? 0} onChange={(v) => setForm((f) => ({ ...f, max_uses: v || null }))} />
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t("Admin.Coupons.labelExpires")}</label>
              <input type="date" value={form.expires_at ?? ""} onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value || null }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex items-center gap-2 mt-5">
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4" />
              <label htmlFor="is_active" className="text-sm">{t("Admin.Coupons.labelActive")}</label>
            </div>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50">
            {saving ? t("Admin.Common.saving") : t("Admin.Coupons.saveCoupon")}
          </button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">{t("Admin.Coupons.columnCode")}</th>
              <th className="text-left px-4 py-3 font-medium">{t("Admin.Coupons.columnDiscount")}</th>
              <th className="text-right px-4 py-3 font-medium">{t("Admin.Coupons.columnUsed")}</th>
              <th className="text-left px-4 py-3 font-medium">{t("Admin.Coupons.columnExpires")}</th>
              <th className="text-left px-4 py-3 font-medium">{t("Admin.Coupons.columnStatus")}</th>
              <th className="text-right px-4 py-3 font-medium">{t("Admin.Coupons.columnActions")}</th>
            </tr>
          </thead>
          <tbody>
            {coupons.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{t("Admin.Coupons.emptyState")}</td></tr>
            ) : coupons.map((c) => (
              <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-4 py-3 font-mono font-medium">{c.code}</td>
                <td className="px-4 py-3">
                  {c.discount_type === "percentage" ? `${c.discount_value}%` : `${c.discount_value} AZN`}
                  {c.description && <span className="text-xs text-muted-foreground ml-2">{c.description}</span>}
                </td>
                <td className="px-4 py-3 text-right">{c.used_count} / {c.max_uses ?? t("Admin.Coupons.unlimited")}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : t("Admin.Coupons.expiresNever")}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleActive(c)}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium transition ${c.is_active ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {c.is_active ? t("Admin.Coupons.statusActive") : t("Admin.Coupons.statusInactive")}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function F({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
    </div>
  );
}
function N({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input type="number" min={0} value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
    </div>
  );
}
