"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";

interface Category {
  id: string;
  slug: string;
  icon_url: string | null;
  category_translations: { lang_code: string; title: string }[];
}

const LANGS = ["az", "ru", "en"];

const EMPTY_FORM = {
  slug: "",
  icon_url: "",
  translations: LANGS.map((lang_code) => ({ lang_code, title: "" })),
};

export default function CategoryManager({ initialCategories }: { initialCategories: Category[] }) {
  const [categories, setCategories] = useState(initialCategories);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setForm({
      slug: c.slug,
      icon_url: c.icon_url ?? "",
      translations: LANGS.map((lang_code) => ({
        lang_code,
        title: c.category_translations.find((t) => t.lang_code === lang_code)?.title ?? "",
      })),
    });
    setShowForm(true);
  };

  const setTitle = (lang_code: string, title: string) => {
    setForm((f) => ({
      ...f,
      translations: f.translations.map((t) => t.lang_code === lang_code ? { ...t, title } : t),
    }));
  };

  const handleSave = async () => {
    if (!form.slug.trim()) return;
    setSaving(true);
    const body = {
      slug: form.slug,
      icon_url: form.icon_url || null,
      translations: form.translations.filter((t) => t.title.trim()),
    };

    if (editing) {
      await fetch(`/api/admin/categories/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setCategories((prev) =>
        prev.map((c) =>
          c.id === editing.id
            ? { ...c, slug: form.slug, icon_url: form.icon_url || null, category_translations: form.translations }
            : c
        )
      );
    } else {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.id) {
        setCategories((prev) => [
          ...prev,
          { id: data.id, slug: form.slug, icon_url: form.icon_url || null, category_translations: form.translations },
        ]);
      }
    }

    setSaving(false);
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/admin/categories/${id}`, { method: "DELETE" });
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="space-y-4">
      <button
        onClick={openNew}
        className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition"
      >
        <Plus size={16} /> New Category
      </button>

      {showForm && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{editing ? "Edit Category" : "New Category"}</h3>
            <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Slug</label>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))}
                placeholder="electronics"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Icon URL (optional)</label>
              <input
                type="url"
                value={form.icon_url}
                onChange={(e) => setForm((f) => ({ ...f, icon_url: e.target.value }))}
                placeholder="https://…"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {LANGS.map((lang) => (
              <div key={lang}>
                <label className="block text-xs text-muted-foreground mb-1">Title ({lang.toUpperCase()})</label>
                <input
                  type="text"
                  value={form.translations.find((t) => t.lang_code === lang)?.title ?? ""}
                  onChange={(e) => setTitle(lang, e.target.value)}
                  placeholder={lang === "az" ? "Kateqoriya" : lang === "ru" ? "Категория" : "Category"}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ))}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Category"}
          </button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">Category (AZ)</th>
              <th className="text-left px-4 py-3 font-medium">Slug</th>
              <th className="text-left px-4 py-3 font-medium">Translations</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No categories yet.</td>
              </tr>
            ) : (
              categories.map((c) => {
                const azTitle = c.category_translations.find((t) => t.lang_code === "az")?.title ?? "—";
                const langs = c.category_translations.map((t) => t.lang_code.toUpperCase()).join(", ");
                return (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{azTitle}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.slug}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{langs}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
