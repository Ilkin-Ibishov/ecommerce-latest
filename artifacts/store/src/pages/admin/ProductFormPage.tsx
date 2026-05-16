import { useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Upload, X, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";

const LANGS = ["az", "ru", "en"];
const LANG_LABELS: Record<string, string> = { az: "Azərbaycan", ru: "Русский", en: "English" };
const defaultTranslations = LANGS.map((lang_code) => ({ lang_code, title: "", description: "" }));

interface ImageItem { url: string; alt_text: string }

export default function ProductFormPage({ productId }: { productId?: string }) {
  const [, navigate] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [activeLang, setActiveLang] = useState("az");
  const [slug, setSlug] = useState("");
  const [price, setPrice] = useState(0);
  const [stock, setStock] = useState(0);
  const [sortOrder, setSortOrder] = useState(0);
  const [isFeatured, setIsFeatured] = useState(false);
  const [isOnSale, setIsOnSale] = useState(false);
  const [isDeal, setIsDeal] = useState(false);
  const [translations, setTranslations] = useState(defaultTranslations);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadingProduct, setLoadingProduct] = useState(!!productId);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("categories").select("id, slug, category_translations(lang_code, title)").order("id")
      .then(({ data }) => setAllCategories(data ?? []));

    if (productId) {
      (async () => {
        const { data } = await (supabase as any).from("products")
          .select("*, product_translations(*), product_images(*), product_categories(category_id)")
          .eq("id", productId).single();
        if (data) {
          setSlug(data.slug); setPrice(data.price); setStock(data.stock);
          setSortOrder(data.sort_order); setIsFeatured(data.is_featured);
          setIsOnSale(data.is_on_sale); setIsDeal(data.is_deal_of_day);
          setTranslations(LANGS.map((lang) => ({
            lang_code: lang,
            title: data.product_translations?.find((t: any) => t.lang_code === lang)?.title ?? "",
            description: data.product_translations?.find((t: any) => t.lang_code === lang)?.description ?? "",
          })));
          setImages((data.product_images ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((img: any) => ({ url: img.url, alt_text: img.alt_text ?? "" })));
          setCategoryIds((data.product_categories ?? []).map((pc: any) => pc.category_id));
        }
        setLoadingProduct(false);
      })();
    }
  }, [productId]);

  const setTranslationField = (lang: string, field: "title" | "description", value: string) => {
    setTranslations((prev) => prev.map((t) => t.lang_code === lang ? { ...t, [field]: value } : t));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setError("");
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(apiUrl("/admin/upload"), { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setImages((prev) => [...prev, { url: data.url, alt_text: "" }]);
    } catch (e: any) { setError(e.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const handleSave = async () => {
    if (!slug.trim() || !translations.some((t) => t.title.trim())) {
      setError("Please fill in slug and at least one title."); return;
    }
    setSaving(true); setError("");
    const body = { slug, price, stock, sort_order: sortOrder, is_featured: isFeatured, is_on_sale: isOnSale, is_deal_of_day: isDeal, translations: translations.filter((t) => t.title.trim()), images, category_ids: categoryIds };
    try {
      const url = productId ? apiUrl(`/admin/products/${productId}`) : apiUrl("/admin/products");
      const method = productId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      navigate("/admin/products");
    } catch (e: any) { setError(e.message); setSaving(false); }
  };

  const currentT = translations.find((t) => t.lang_code === activeLang)!;
  if (loadingProduct) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/products" className="text-muted-foreground hover:text-foreground text-sm transition">← Products</Link>
        <h1 className="text-2xl font-bold">{productId ? "Edit Product" : "New Product"}</h1>
      </div>

      {error && <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg">{error}</div>}

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Basic Info</h2>
        <div className="grid grid-cols-2 gap-4">
          <F label="Slug" value={slug} onChange={setSlug} placeholder="product-slug" />
          <N label="Price (AZN)" value={price} onChange={setPrice} />
          <N label="Stock" value={stock} onChange={setStock} integer />
          <N label="Sort Order" value={sortOrder} onChange={setSortOrder} integer />
        </div>
        <div className="flex gap-6">
          {[["Featured", isFeatured, setIsFeatured], ["On Sale", isOnSale, setIsOnSale], ["Deal of Day", isDeal, setIsDeal]].map(([label, val, setter]: any) => (
            <label key={label as string} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={val as boolean} onChange={(e) => setter(e.target.checked)} className="w-4 h-4" />
              {label as string}
            </label>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Translations</h2>
        <div className="flex gap-2">
          {LANGS.map((l) => (
            <button key={l} onClick={() => setActiveLang(l)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${activeLang === l ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}>
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
        <F label="Title" value={currentT.title} onChange={(v) => setTranslationField(activeLang, "title", v)} placeholder={`Product title in ${activeLang}`} />
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea value={currentT.description} onChange={(e) => setTranslationField(activeLang, "description", e.target.value)}
            rows={4} placeholder={`Description in ${activeLang}`}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Images</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {images.map((img, i) => (
            <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted">
              <img src={img.url} alt="" className="object-cover w-full h-full" />
              <button onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs">
                <X size={10} />
              </button>
            </div>
          ))}
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="aspect-square rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 hover:border-primary/50 transition text-muted-foreground disabled:opacity-50">
            <Upload size={20} />
            <span className="text-xs">{uploading ? "..." : "Upload"}</span>
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
      </div>

      {allCategories.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h2 className="font-semibold">Categories</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {allCategories.map((cat) => {
              const title = cat.category_translations?.find((t: any) => t.lang_code === "az")?.title ?? cat.slug;
              const checked = categoryIds.includes(cat.id);
              return (
                <label key={cat.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={checked}
                    onChange={(e) => setCategoryIds((prev) => e.target.checked ? [...prev, cat.id] : prev.filter((id) => id !== cat.id))}
                    className="w-4 h-4" />
                  {title}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition disabled:opacity-50">
          {saving ? "Saving…" : "Save Product"}
        </button>
        <Link href="/admin/products" className="px-6 py-2.5 bg-muted/50 text-muted-foreground rounded-lg hover:bg-muted transition text-sm">
          Cancel
        </Link>
      </div>
    </div>
  );
}

function F({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
    </div>
  );
}

function N({ label, value, onChange, integer }: { label: string; value: number; onChange: (v: number) => void; integer?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input type="number" min={0} step={integer ? 1 : 0.01} value={value}
        onChange={(e) => onChange(integer ? parseInt(e.target.value) || 0 : parseFloat(e.target.value) || 0)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
    </div>
  );
}
