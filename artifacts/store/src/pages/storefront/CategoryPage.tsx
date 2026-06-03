import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { apiUrl } from "@/lib/api";
import ProductCard from "@/components/storefront/ProductCard";
import { ArrowUpDown, ChevronDown } from "lucide-react";

const SORT_OPTIONS = [
  { value: "sort_order", label: "Tövsiyə edilən" },
  { value: "price_asc", label: "Qiymət: Aşağıdan yuxarı" },
  { value: "price_desc", label: "Qiymət: Yuxarıdan aşağı" },
  { value: "newest", label: "Ən yeni" },
];

export default function CategoryPage({ locale, slug }: { locale: string; slug: string }) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const sortParam = params.get("sort") ?? "sort_order";
  const pageSize = 24;

  const [category, setCategory] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const url = apiUrl(`/categories/${slug}/products?page=${page}&limit=${pageSize}&sort=${sortParam}`);
        const res = await fetch(url);
        if (res.status === 404) { setNotFound(true); setLoading(false); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setCategory(json.category);
        setProducts(json.products ?? []);
        setCount(json.total ?? 0);
      } catch (e) {
        console.error("[CategoryPage]", e);
      }
      setLoading(false);
    }
    load();
  }, [slug, page, sortParam]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">Yüklənir…</div>;
  if (notFound) return (
    <div className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold mb-4">Kateqoriya tapılmadı</h1>
      <Link href={`/${locale}/categories`} className="text-primary hover:underline">Kateqoriyalara qayıt</Link>
    </div>
  );

  const getTitle = (translations: any[]) =>
    translations?.find((t: any) => t.lang_code === locale)?.title ?? translations?.[0]?.title ?? "Untitled";

  const catTitle = category ? getTitle(category.category_translations) : "";
  const totalPages = Math.ceil(count / pageSize);
  const currentSort = SORT_OPTIONS.find(o => o.value === sortParam) ?? SORT_OPTIONS[0];

  const buildUrl = (overrides: Record<string, string | null>) => {
    const p = new URLSearchParams(search);
    Object.entries(overrides).forEach(([k, v]) => {
      if (v === null) p.delete(k); else p.set(k, v);
    });
    p.delete("page");
    const qs = p.toString();
    return `/${locale}/categories/${slug}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-1 flex-wrap">
        <Link href={`/${locale}`} className="hover:text-foreground">Ana səhifə</Link>
        <span>/</span>
        <Link href={`/${locale}/categories`} className="hover:text-foreground">Kateqoriyalar</Link>
        <span>/</span>
        <span className="text-foreground">{catTitle}</span>
      </nav>

      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{catTitle}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{count} məhsul</p>
        </div>
        {/* Sort */}
        <div className="relative">
          <button
            onClick={() => setSortOpen(!sortOpen)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent transition"
          >
            <ArrowUpDown size={14} />
            {currentSort.label}
            <ChevronDown size={13} className={`transition-transform ${sortOpen ? "rotate-180" : ""}`} />
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-52 bg-background border border-border rounded-xl shadow-lg z-40 overflow-hidden">
                {SORT_OPTIONS.map((opt) => (
                  <Link key={opt.value} href={buildUrl({ sort: opt.value })}
                    onClick={() => setSortOpen(false)}
                    className={`block px-4 py-2.5 text-sm transition hover:bg-accent ${sortParam === opt.value ? "text-primary font-semibold bg-primary/5" : ""}`}>
                    {opt.label}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {products.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <p className="text-xl">Bu kateqoriyada məhsul yoxdur</p>
          <Link href={`/${locale}/products`} className="text-primary text-sm hover:underline mt-2 block">Bütün məhsullara bax</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
          {products.map((product: any) => (
            <ProductCard
              key={product.id}
              productId={product.id}
              slug={product.slug}
              title={getTitle(product.product_translations)}
              price={product.price}
              originalPrice={product.original_price}
              image={product.product_images?.[0]?.url ?? null}
              isOnSale={product.is_on_sale}
              isDealOfDay={product.is_deal_of_day}
              stock={product.stock}
              brand={product.brand}
              locale={locale}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-10">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/${locale}/categories/${slug}?page=${p}${sortParam !== "sort_order" ? `&sort=${sortParam}` : ""}`}
              className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition ${p === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}>
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
