import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";

interface Coupon {
  id: string; code: string; description: string | null;
  discount_type: "percentage" | "fixed"; discount_value: number;
  min_order_amount: number | null; max_uses: number | null;
  used_count: number; is_active: boolean; expires_at: string | null;
}

const EMPTY = { code: "", description: "", discount_type: "percentage" as const, discount_value: 10, min_order_amount: null as number | null, max_uses: null as number | null, is_active: true, expires_at: null as string | null };

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (supabase as any).from("coupons").select("*").order("created_at", { ascending: false })
      .then(({ data }: any) => setCoupons(data ?? []));
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
      await fetch(apiUrl(`/admin/coupons/${editing.id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setCoupons((prev) => prev.map((c) => c.id === editing.id ? { ...c, ...form } : c));
    } else {
      const res = await fetch(apiUrl("/admin/coupons"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.id) setCoupons((prev) => [{ id: data.id, used_count: 0, ...form } as Coupon, ...prev]);
    }
    setSaving(false); setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(apiUrl(`/admin/coupons/${id}`), { method: "DELETE" });
    setCoupons((prev) => prev.filter((c) => c.id !== id));
  };

  const toggleActive = async (c: Coupon) => {
    await fetch(apiUrl(`/admin/coupons/${c.id}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...c, is_active: !c.is_active }) });
    setCoupons((prev) => prev.map((x) => x.id === c.id ? { ...x, is_active: !x.is_active } : x));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Coupons</h1>
      <button onClick={openNew} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition">
        <Plus size={16} /> New Coupon
      </button>

      {showForm && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{editing ? "Edit Coupon" : "New Coupon"}</h3>
            <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <F label="Code" value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))} placeholder="SUMMER20" />
            <F label="Description" value={form.description ?? ""} onChange={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="Optional" />
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Type</label>
              <select value={form.discount_type} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value as any }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed (AZN)</option>
              </select>
            </div>
            <N label={form.discount_type === "percentage" ? "Discount %" : "Discount AZN"} value={form.discount_value} onChange={(v) => setForm((f) => ({ ...f, discount_value: v }))} />
            <N label="Min Order (AZN)" value={form.min_order_amount ?? 0} onChange={(v) => setForm((f) => ({ ...f, min_order_amount: v || null }))} />
            <N label="Max Uses (0 = unlimited)" value={form.max_uses ?? 0} onChange={(v) => setForm((f) => ({ ...f, max_uses: v || null }))} />
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Expires</label>
              <input type="date" value={form.expires_at ?? ""} onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value || null }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex items-center gap-2 mt-5">
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4" />
              <label htmlFor="is_active" className="text-sm">Active</label>
            </div>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50">
            {saving ? "Saving…" : "Save Coupon"}
          </button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">Code</th>
              <th className="text-left px-4 py-3 font-medium">Discount</th>
              <th className="text-right px-4 py-3 font-medium">Used / Max</th>
              <th className="text-left px-4 py-3 font-medium">Expires</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {coupons.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No coupons yet.</td></tr>
            ) : coupons.map((c) => (
              <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-4 py-3 font-mono font-medium">{c.code}</td>
                <td className="px-4 py-3">
                  {c.discount_type === "percentage" ? `${c.discount_value}%` : `${c.discount_value} AZN`}
                  {c.description && <span className="text-xs text-muted-foreground ml-2">{c.description}</span>}
                </td>
                <td className="px-4 py-3 text-right">{c.used_count} / {c.max_uses ?? "∞"}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "Never"}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleActive(c)}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium transition ${c.is_active ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"}`}>
                    {c.is_active ? "Active" : "Inactive"}
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
