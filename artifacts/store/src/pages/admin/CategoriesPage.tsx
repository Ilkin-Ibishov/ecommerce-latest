import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";

interface SubCategory {
  id: string;
  slug: string;
  category_translations: { lang_code: string; title: string }[];
}

interface Category {
  id: string;
  slug: string;
  icon_url: string | null;
  category_translations: { lang_code: string; title: string }[];
  subcategories?: SubCategory[];
}

const LANGS = ["az", "ru", "en"];
const EMPTY_FORM = {
  slug: "",
  icon_url: "",
  parent_id: null as string | null,
  translations: LANGS.map((lang_code) => ({ lang_code, title: "" })),
};

function getTitle(translations: { lang_code: string; title: string }[], lang = "az"): string {
  return translations.find((t) => t.lang_code === lang)?.title
    ?? translations[0]?.title
    ?? "Untitled";
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Category | SubCategory | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: "", message: "", onConfirm: () => {} });

  const load = () => {
    const supabase = createClient();
    (supabase as any)
      .from("categories")
      .select("*, category_translations(*), subcategories:categories!parent_id(id, slug, category_translations(*))")
      .is("parent_id", null)
      .order("id")
      .then(({ data }: any) => { setCategories(data ?? []); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openAddSub = (parent: Category) => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, parent_id: parent.id });
    setShowForm(true);
  };

  const openEdit = (c: Category | SubCategory, parentId?: string) => {
    setEditing(c);
    setForm({
      slug: c.slug,
      icon_url: ("icon_url" in c ? c.icon_url : null) ?? "",
      parent_id: parentId ?? null,
      translations: LANGS.map((lang_code) => ({
        lang_code,
        title: c.category_translations.find((t) => t.lang_code === lang_code)?.title ?? "",
      })),
    });
    setShowForm(true);
  };

  const setTitle = (lang_code: string, title: string) =>
    setForm((f) => ({ ...f, translations: f.translations.map((t) => t.lang_code === lang_code ? { ...t, title } : t) }));

  const handleSave = async () => {
    if (!form.slug.trim()) return;
    setSaving(true);
    const body = {
      slug: form.slug,
      icon_url: form.icon_url || null,
      parent_id: form.parent_id ?? null,
      translations: form.translations.filter((t) => t.title.trim()),
    };
    if (editing) {
      await adminFetch(apiUrl(`/admin/categories/${editing.id}`), { method: "PATCH", body: JSON.stringify(body) });
    } else {
      await adminFetch(apiUrl("/admin/categories"), { method: "POST", body: JSON.stringify(body) });
    }
    setSaving(false);
    setShowForm(false);
    load(); // reload to get fresh hierarchy
  };

  const handleDelete = async (id: string, catName: string, subCount = 0) => {
    const msg = subCount > 0
      ? `Delete "${catName}" and its ${subCount} subcategory(s)? This cannot be undone.`
      : `Delete "${catName}"?`;
    setConfirmState({
      open: true,
      title: "Delete Category",
      message: msg,
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }));
        await adminFetch(apiUrl(`/admin/categories/${id}`), { method: "DELETE" });
        load();
      },
    });
  };

  const parentName = form.parent_id
    ? getTitle(categories.find((c) => c.id === form.parent_id)?.category_translations ?? [])
    : null;

  if (loading) return <div className="text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Categories</h1>
        <button onClick={openNew} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition">
          <Plus size={16} /> New Category
        </button>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              {editing ? "Edit" : parentName ? "New Subcategory" : "New Category"}
            </h3>
            <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
          </div>

          {/* Parent context banner for subcategories */}
          {parentName && (
            <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
              📁 Adding subcategory under: <strong>{parentName}</strong>
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <F label="Slug" value={form.slug} onChange={(v) => setForm((f) => ({ ...f, slug: v }))} placeholder="category-slug" />
            {/* Only root categories have icon_url */}
            {!form.parent_id && (
              <F label="Icon URL (optional)" value={form.icon_url} onChange={(v) => setForm((f) => ({ ...f, icon_url: v }))} placeholder="https://..." />
            )}
          </div>
          <div className="space-y-3">
            {LANGS.map((lang) => (
              <F
                key={lang}
                label={`Title (${lang})`}
                value={form.translations.find((t) => t.lang_code === lang)?.title ?? ""}
                onChange={(v) => setTitle(lang, v)}
                placeholder={`Category name in ${lang}`}
              />
            ))}
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {/* Categories table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-3 font-medium">Name (AZ)</th>
                <th className="text-left px-4 py-3 font-medium">Slug</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">No categories yet.</td></tr>
              ) : categories.map((cat) => {
                const subs = cat.subcategories ?? [];
                const title = getTitle(cat.category_translations);
                return (
                  <>
                    {/* Root category row */}
                    <tr key={cat.id} className="border-b border-border/50 bg-muted/5 hover:bg-muted/20 transition">
                      <td className="px-4 py-3 font-semibold">
                        <div className="flex items-center gap-2">
                          {cat.icon_url && <img src={cat.icon_url} alt="" className="w-5 h-5 rounded object-cover" />}
                          {title}
                          {subs.length > 0 && (
                            <span className="text-xs text-muted-foreground font-normal">
                              ({subs.length})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{cat.slug}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openAddSub(cat)}
                            title="Add subcategory"
                            className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition"
                          >
                            <Plus size={13} />
                          </button>
                          <button onClick={() => openEdit(cat)} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition">
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(cat.id, title, subs.length)}
                            className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Subcategory rows */}
                    {subs.map((sub) => {
                      const subTitle = getTitle(sub.category_translations);
                      return (
                        <tr key={sub.id} className="border-b border-border/30 hover:bg-muted/10 transition">
                          <td className="px-4 py-2 pl-10 text-muted-foreground text-sm">
                            <span className="text-muted-foreground/40 mr-1.5">└</span>
                            {subTitle}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{sub.slug}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEdit(sub, cat.id)} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition">
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => handleDelete(sub.id, subTitle)}
                                className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel="Delete"
        destructive={true}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
      />
    </div>
  );
}

function F({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <input
        type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}
