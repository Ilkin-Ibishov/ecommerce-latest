"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Upload, X, GripVertical, Plus } from "lucide-react";

const LANGS = ["az", "ru", "en"];
const LANG_LABELS: Record<string, string> = { az: "Azərbaycan", ru: "Русский", en: "English" };

interface ImageItem { url: string; alt_text: string }

interface ProductFormProps {
  productId?: string;
  initial?: {
    slug: string;
    price: number;
    stock: number;
    sort_order: number;
    is_featured: boolean;
    is_on_sale: boolean;
    is_deal_of_day: boolean;
    translations: { lang_code: string; title: string; description: string }[];
    images: ImageItem[];
    category_ids: string[];
  };
  categories: { id: string; slug: string; category_translations: { lang_code: string; title: string }[] }[];
}

const defaultTranslations = LANGS.map((lang_code) => ({ lang_code, title: "", description: "" }));

export default function ProductForm({ productId, initial, categories }: ProductFormProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [activeLang, setActiveLang] = useState("az");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [price, setPrice] = useState(initial?.price ?? 0);
  const [stock, setStock] = useState(initial?.stock ?? 0);
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [isFeatured, setIsFeatured] = useState(initial?.is_featured ?? false);
  const [isOnSale, setIsOnSale] = useState(initial?.is_on_sale ?? false);
  const [isDeal, setIsDeal] = useState(initial?.is_deal_of_day ?? false);
  const [translations, setTranslations] = useState(
    initial?.translations?.length
      ? LANGS.map((lang) => ({
          lang_code: lang,
          title: initial.translations.find((t) => t.lang_code === lang)?.title ?? "",
          description: initial.translations.find((t) => t.lang_code === lang)?.description ?? "",
        }))
      : defaultTranslations
  );
  const [images, setImages] = useState<ImageItem[]>(initial?.images ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(initial?.category_ids ?? []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const currentTranslation = translations.find((t) => t.lang_code === activeLang)!;

  const setTranslationField = (lang: string, field: "title" | "description", value: string) => {
    setTranslations((prev) =>
      prev.map((t) => (t.lang_code === lang ? { ...t, [field]: value } : t))
    );
  };

  const autoSlug = (title: string) => {
    if (!slug || (!initial && translations.find((t) => t.lang_code === "az")?.title === "")) {
      setSlug(
        title
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-")
      );
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setImages((prev) => [...prev, { url: data.url, alt_text: "" }]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleCategory = (id: string) => {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!translations.find((t) => t.lang_code === "az")?.title.trim()) {
      setError("Azerbaijani title is required.");
      return;
    }
    setSaving(true);
    const body = {
      slug,
      price,
      stock,
      sort_order: sortOrder,
      is_featured: isFeatured,
      is_on_sale: isOnSale,
      is_deal_of_day: isDeal,
      translations: translations.filter((t) => t.title.trim()),
      images,
      category_ids: categoryIds,
    };

    const url = productId ? `/api/admin/products/${productId}` : "/api/admin/products";
    const method = productId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to save product.");
      setSaving(false);
      return;
    }

    router.push("/admin/products");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      {/* Language tabs */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex gap-2">
          {LANGS.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setActiveLang(lang)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeLang === lang
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {LANG_LABELS[lang]}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Title ({activeLang.toUpperCase()}) {activeLang === "az" && <span className="text-red-400">*</span>}
          </label>
          <input
            type="text"
            value={currentTranslation.title}
            onChange={(e) => {
              setTranslationField(activeLang, "title", e.target.value);
              if (activeLang === "az") autoSlug(e.target.value);
            }}
            placeholder={activeLang === "az" ? "Məhsulun adı" : activeLang === "ru" ? "Название товара" : "Product title"}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">Description ({activeLang.toUpperCase()})</label>
          <textarea
            value={currentTranslation.description}
            onChange={(e) => setTranslationField(activeLang, "description", e.target.value)}
            rows={4}
            placeholder={activeLang === "az" ? "Məhsulun təsviri…" : activeLang === "ru" ? "Описание товара…" : "Product description…"}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>
      </div>

      {/* Basics */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="font-semibold">Product Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="product-slug"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Sort Order</label>
            <input
              type="number"
              min={0}
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Price (AZN)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={price}
              onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Stock</label>
            <input
              type="number"
              min={0}
              value={stock}
              onChange={(e) => setStock(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex gap-6">
          {[
            { label: "Featured", value: isFeatured, set: setIsFeatured },
            { label: "On Sale", value: isOnSale, set: setIsOnSale },
            { label: "Deal of the Day", value: isDeal, set: setIsDeal },
          ].map(({ label, value, set }) => (
            <label key={label} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => set(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Images */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h3 className="font-semibold">Images</h3>
        <div className="grid grid-cols-4 gap-3">
          {images.map((img, idx) => (
            <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted">
              <Image src={img.url} alt={img.alt_text || ""} fill className="object-cover" sizes="120px" />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
              >
                <X size={10} />
              </button>
              {idx === 0 && (
                <span className="absolute bottom-1 left-1 text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded font-medium">
                  Main
                </span>
              )}
            </div>
          ))}

          <label className={`aspect-square rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center cursor-pointer transition ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
            {uploading ? (
              <span className="text-xs text-muted-foreground">Uploading…</span>
            ) : (
              <>
                <Upload size={20} className="text-muted-foreground mb-1" />
                <span className="text-xs text-muted-foreground">Add image</span>
              </>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} className="sr-only" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">First image is the main display image. Max 10 MB per file.</p>
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h3 className="font-semibold">Categories</h3>
          <div className="flex gap-2 flex-wrap">
            {categories.map((cat) => {
              const label =
                cat.category_translations.find((t) => t.lang_code === "az")?.title ??
                cat.slug;
              const selected = categoryIds.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition ${
                    selected
                      ? "bg-primary text-primary-foreground font-medium"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition disabled:opacity-60"
        >
          {saving ? "Saving…" : productId ? "Update Product" : "Create Product"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/products")}
          className="px-6 py-2.5 bg-muted/50 text-muted-foreground rounded-lg font-medium hover:bg-muted transition"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
