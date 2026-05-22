import { useEffect, useState, useRef } from "react";
import { Plus, Pencil, Trash2, Upload, X, ImageIcon, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { adminFetch, adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import imageCompression from "browser-image-compression";

interface Banner {
  id: string;
  title: string;
  subtitle: string;
  image_url: string;
  cta_text: string;
  cta_url: string;
  sort_order: number;
  active: boolean;
}

const empty: Omit<Banner, "id"> = {
  title: "", subtitle: "", image_url: "", cta_text: "", cta_url: "",
  sort_order: 0, active: true,
};

export default function BannersPage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; editing: Banner | null }>({ open: false, editing: null });
  const [form, setForm] = useState<Omit<Banner, "id">>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const supabase = createClient();
    const { data } = await (supabase as any).from("banners").select("*").order("sort_order");
    setBanners(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setForm(empty);
    setError("");
    setModal({ open: true, editing: null });
  };

  const openEdit = (b: Banner) => {
    setForm({ title: b.title, subtitle: b.subtitle ?? "", image_url: b.image_url ?? "",
      cta_text: b.cta_text ?? "", cta_url: b.cta_url ?? "", sort_order: b.sort_order, active: b.active });
    setError("");
    setModal({ open: true, editing: b });
  };

  const closeModal = () => { setModal({ open: false, editing: null }); setError(""); };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 2, maxWidthOrHeight: 1920, useWebWorker: true,
        fileType: "image/webp", initialQuality: 0.85,
      });
      const webpFile = new File([compressed], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" });
      const fd = new FormData();
      fd.append("file", webpFile);
      const data = await adminJson(apiUrl("/admin/upload"), { method: "POST", body: fd });
      setForm((f) => ({ ...f, image_url: data.url }));
    } catch (e: any) { setError(e.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const handleSave = async () => {
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError("");
    try {
      if (modal.editing) {
        await adminJson(apiUrl(`/admin/banners/${modal.editing.id}`), {
          method: "PATCH", body: JSON.stringify(form),
        });
      } else {
        await adminJson(apiUrl("/admin/banners"), {
          method: "POST", body: JSON.stringify(form),
        });
      }
      closeModal();
      await load();
    } catch (e: any) { setError(e.message); setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this banner?")) return;
    setDeleting(id);
    try {
      await adminFetch(apiUrl(`/admin/banners/${id}`), { method: "DELETE" });
      await load();
    } finally { setDeleting(null); }
  };

  const toggleActive = async (b: Banner) => {
    await adminJson(apiUrl(`/admin/banners/${b.id}`), {
      method: "PATCH", body: JSON.stringify({ ...b, active: !b.active }),
    });
    await load();
  };

  const F = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Hero Banners</h1>
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition">
          <Plus size={16} /> Add Banner
        </button>
      </div>
      <p className="text-sm text-muted-foreground">Banners appear in the homepage hero carousel. Drag to reorder by changing Sort Order.</p>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : banners.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl text-muted-foreground">
          <ImageIcon size={40} className="mx-auto mb-3 opacity-30" />
          <p>No banners yet. Add your first banner to show a hero carousel on the homepage.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((b) => (
            <div key={b.id} className={`bg-card border rounded-xl overflow-hidden flex gap-0 ${b.active ? "border-border" : "border-border/50 opacity-60"}`}>
              <div className="w-32 h-24 shrink-0 bg-muted overflow-hidden">
                {b.image_url ? (
                  <img src={b.image_url} alt={b.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                    <ImageIcon size={24} />
                  </div>
                )}
              </div>
              <div className="flex-1 px-4 py-3 min-w-0">
                <p className="font-semibold text-sm truncate">{b.title}</p>
                {b.subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{b.subtitle}</p>}
                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  <span>Sort: {b.sort_order}</span>
                  {b.cta_text && <span>CTA: "{b.cta_text}"</span>}
                  {b.cta_url && <span className="truncate max-w-[160px]">→ {b.cta_url}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 px-3 shrink-0">
                <button onClick={() => toggleActive(b)} title={b.active ? "Deactivate" : "Activate"}
                  className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition">
                  {b.active ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button onClick={() => openEdit(b)}
                  className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition">
                  <Pencil size={15} />
                </button>
                <button onClick={() => handleDelete(b.id)} disabled={deleting === b.id}
                  className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition disabled:opacity-50">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-background border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-bold text-lg">{modal.editing ? "Edit Banner" : "New Banner"}</h2>
              <button onClick={closeModal} className="p-2 rounded-lg hover:bg-accent transition"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              {error && <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg">{error}</div>}

              {/* Image */}
              <div>
                <label className="block text-sm font-medium mb-2">Banner Image</label>
                <div className="flex gap-3 items-start">
                  <div className="w-28 h-20 rounded-lg overflow-hidden bg-muted border border-border shrink-0">
                    {form.image_url ? (
                      <img src={form.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                        <ImageIcon size={20} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <button onClick={() => fileRef.current?.click()} disabled={uploading}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/50 text-sm hover:bg-muted transition disabled:opacity-50 w-full">
                      <Upload size={14} /> {uploading ? "Uploading…" : "Upload image"}
                    </button>
                    <input type="text" value={form.image_url}
                      onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
                      placeholder="Or paste image URL"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </div>

              <F label="Title *" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} placeholder="Main headline text" />
              <F label="Subtitle" value={form.subtitle} onChange={(v) => setForm((f) => ({ ...f, subtitle: v }))} placeholder="Supporting text (optional)" />
              <div className="grid grid-cols-2 gap-4">
                <F label="CTA Button Text" value={form.cta_text} onChange={(v) => setForm((f) => ({ ...f, cta_text: v }))} placeholder="e.g. Shop Now" />
                <F label="CTA Link URL" value={form.cta_url} onChange={(v) => setForm((f) => ({ ...f, cta_url: v }))} placeholder="e.g. /products" />
              </div>
              <div className="grid grid-cols-2 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium mb-1">Sort Order</label>
                  <input type="number" min={0} step={1} value={form.sort_order}
                    onChange={(e) => setForm((f) => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                    className="w-4 h-4" />
                  Active (visible on site)
                </label>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition disabled:opacity-50">
                {saving ? "Saving…" : modal.editing ? "Save Changes" : "Create Banner"}
              </button>
              <button onClick={closeModal}
                className="px-5 py-2.5 bg-muted/50 text-muted-foreground rounded-lg hover:bg-muted transition text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
