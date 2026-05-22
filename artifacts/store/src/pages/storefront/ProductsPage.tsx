import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Filter, ArrowUpDown, ChevronDown, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ProductCard from "@/components/storefront/ProductCard";
import BouncingLoader from "@/components/ui/BouncingLoader";

const SORT_OPTIONS = [
  { value: "sort_order", label: "Tövsiyə edilən" },
  { value: "price_asc", label: "Qiymət: Aşağıdan yuxarı" },
  { value: "price_desc", label: "Qiymət: Yuxarıdan aşağı" },
  { value: "newest", label: "Ən yeni" },
];

export default function ProductsPage({ locale }: { locale: string }) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const sale = params.get("sale");
  const deal = params.get("deal");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const sortParam = params.get("sort") ?? "sort_order";
  const brandParam = params.get("brand") ?? "";
  const inStockParam = params.get("instock") === "true";
  const priceMinParam = params.get("pmin") ?? "";
  const priceMaxParam = params.get("pmax") ?? "";
  const pageSize = 24;
  const offset = (page - 1) * pageSize;

  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [priceMin, setPriceMin] = useState(priceMinParam);
  const [priceMax, setPriceMax] = useState(priceMaxParam);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      setLoading(true);
      let query = (supabase as any)
        .from("products")
        .select("id, slug, price, original_price, stock, is_on_sale, is_deal_of_day, brand, product_images(*), product_translations(*)", { count: "exact" })
        .range(offset, offset + pageSize - 1);

      if (sale === "true") query = query.eq("is_on_sale", true);
      if (deal === "true") query = query.eq("is_deal_of_day", true);
      if (brandParam) query = query.eq("brand", brandParam);
      if (inStockParam) query = query.gt("stock", 0);
      if (priceMinParam) query = query.gte("price", parseFloat(priceMinParam));
      if (priceMaxParam) query = query.lte("price", parseFloat(priceMaxParam));

      if (sortParam === "price_asc") query = query.order("price", { ascending: true });
      else if (sortParam === "price_desc") query = query.order("price", { ascending: false });
      else if (sortParam === "newest") query = query.order("created_at", { ascending: false });
      else query = query.order("sort_order");

      const { data, count: total } = await query;
      setProducts(data ?? []);
      setCount(total ?? 0);

      const { data: cats } = await supabase.from("categories")
        .select("id, slug, category_translations(*)").is("parent_id", null);
      setCategories(cats ?? []);

      const { data: brandRows } = await (supabase as any)
        .from("products")
        .select("brand")
        .not("brand", "is", null)
        .neq("brand", "");
      const uniqueBrands = [...new Set((brandRows ?? []).map((r: any) => r.brand).filter(Boolean))].sort() as string[];
      setBrands(uniqueBrands);

      setLoading(false);
    }
    load();
  }, [sale, deal, page, sortParam, brandParam, inStockParam, priceMinParam, priceMaxParam]);

  const getTitle = (translations: any[] | null) =>
    translations?.find((t: any) => t.lang_code === locale)?.title ?? translations?.[0]?.title ?? "Untitled";

  const totalPages = Math.ceil(count / pageSize);

  const buildUrl = (overrides: Record<string, string | null>) => {
    const p = new URLSearchParams(search);
    Object.entries(overrides).forEach(([k, v]) => {
      if (v === null) p.delete(k); else p.set(k, v);
    });
    p.delete("page");
    const qs = p.toString();
    return `/${locale}/products${qs ? `?${qs}` : ""}`;
  };

  const applyPriceFilter = () => {
    const p = new URLSearchParams(search);
    if (priceMin) p.set("pmin", priceMin); else p.delete("pmin");
    if (priceMax) p.set("pmax", priceMax); else p.delete("pmax");
    p.delete("page");
    window.location.href = `/${locale}/products${p.toString() ? `?${p.toString()}` : ""}`;
  };

  const currentSort = SORT_OPTIONS.find((o) => o.value === sortParam) ?? SORT_OPTIONS[0];

  const activeFilterCount = [
    brandParam, inStockParam ? "1" : "", priceMinParam, priceMaxParam,
    sale === "true" ? "1" : "", deal === "true" ? "1" : "",
  ].filter(Boolean).length;

  const FilterSidebar = () => (
    <div className="space-y-5">
      {/* Type filter */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Növ</p>
        <div className="space-y-1">
          <FilterLink href={buildUrl({ sale: null, deal: null })} active={!sale && !deal} label="Bütün məhsullar" />
          <FilterLink href={buildUrl({ sale: "true", deal: null })} active={sale === "true"} label="Endirimli" />
          <FilterLink href={buildUrl({ deal: "true", sale: null })} active={deal === "true"} label="Günün təklifi" />
        </div>
      </div>

      {/* Stock filter */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Stok</p>
        <FilterLink href={buildUrl({ instock: inStockParam ? null : "true" })} active={inStockParam} label="Yalnız stokda olanlar" />
      </div>

      {/* Brand filter */}
      {brands.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Brend</p>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {brandParam && (
              <FilterLink href={buildUrl({ brand: null })} active={false} label="Hamısı" />
            )}
            {brands.map((b) => (
              <FilterLink key={b} href={buildUrl({ brand: b === brandParam ? null : b })} active={brandParam === b} label={b} />
            ))}
          </div>
        </div>
      )}

      {/* Price range */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Qiymət (AZN)</p>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            placeholder="Min"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-muted-foreground text-sm">—</span>
          <input
            type="number"
            placeholder="Max"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          onClick={applyPriceFilter}
          className="mt-2 w-full py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition"
        >
          Tətbiq et
        </button>
        {(priceMinParam || priceMaxParam) && (
          <button
            onClick={() => {
              setPriceMin(""); setPriceMax("");
              window.location.href = buildUrl({ pmin: null, pmax: null });
            }}
            className="mt-1 w-full py-1 text-xs text-muted-foreground hover:text-foreground transition flex items-center justify-center gap-1"
          >
            <X size={10} /> Qiymət filtrini sil
          </button>
        )}
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Kateqoriya</p>
          <div className="space-y-1">
            {categories.map((cat: any) => (
              <FilterLink key={cat.id} href={`/${locale}/categories/${cat.slug}`} active={false} label={getTitle(cat.category_translations)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8">

      {/* Mobile filter/sort bar */}
      <div className="flex items-center gap-2 mb-4 md:hidden">
        <button
          onClick={() => setFilterOpen(!filterOpen)}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium hover:bg-accent transition ${filterOpen ? "border-primary text-primary" : "border-border"}`}
        >
          <Filter size={15} /> Filtr
          {activeFilterCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
        <div className="relative flex-1">
          <button
            onClick={() => setSortOpen(!sortOpen)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent transition"
          >
            <ArrowUpDown size={15} /> Sırala <ChevronDown size={14} className={`ml-auto transition-transform ${sortOpen ? "rotate-180" : ""}`} />
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setSortOpen(false)} />
              <div className="absolute left-0 right-0 top-full mt-1 bg-background border border-border rounded-xl shadow-lg z-40 overflow-hidden">
                {SORT_OPTIONS.map((opt) => (
                  <Link key={opt.value} href={buildUrl({ sort: opt.value })}
                    onClick={() => setSortOpen(false)}
                    className={`block px-4 py-2.5 text-sm transition hover:bg-accent ${sortParam === opt.value ? "text-primary font-semibold" : ""}`}>
                    {opt.label}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile filter panel */}
      {filterOpen && (
        <div className="md:hidden bg-card border border-border rounded-xl p-4 mb-4">
          <FilterSidebar />
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-8">
        {/* Desktop sidebar */}
        <aside className="hidden md:block w-56 shrink-0">
          <div className="bg-card border border-border rounded-xl p-4 sticky top-20">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Filter size={16} /> Filtrlər
              {activeFilterCount > 0 && (
                <span className="ml-auto text-xs text-primary font-medium">{activeFilterCount} aktiv</span>
              )}
            </h3>
            <FilterSidebar />
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4 sm:mb-6 gap-3">
            <h1 className="text-xl sm:text-2xl font-bold">
              {brandParam ? brandParam :
               sale === "true" ? "Endirimli məhsullar" :
               deal === "true" ? "Günün təklifi" : "Bütün məhsullar"}
            </h1>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground hidden sm:block">{loading ? "…" : `${count} məhsul`}</span>
              <div className="relative hidden md:block">
                <button
                  onClick={() => setSortOpen(!sortOpen)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent transition"
                >
                  <ArrowUpDown size={14} />
                  <span className="hidden lg:inline">{currentSort.label}</span>
                  <span className="lg:hidden">Sırala</span>
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
          </div>

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {brandParam && (
                <Link href={buildUrl({ brand: null })}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition">
                  {brandParam} <X size={10} />
                </Link>
              )}
              {inStockParam && (
                <Link href={buildUrl({ instock: null })}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition">
                  Stokda var <X size={10} />
                </Link>
              )}
              {(priceMinParam || priceMaxParam) && (
                <button
                  onClick={() => window.location.href = buildUrl({ pmin: null, pmax: null })}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition">
                  {priceMinParam && priceMaxParam ? `${priceMinParam}–${priceMaxParam} AZN` :
                   priceMinParam ? `${priceMinParam}+ AZN` : `≤${priceMaxParam} AZN`}
                  <X size={10} />
                </button>
              )}
              <Link href={buildUrl({ sale: null, deal: null, brand: null, instock: null, pmin: null, pmax: null })}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/70 transition">
                Hamısını sil <X size={10} />
              </Link>
            </div>
          )}

          {loading ? (
            <BouncingLoader label="Yüklənir…" className="py-32" />
          ) : products.length === 0 ? (
            <div className="text-center py-24 text-muted-foreground">
              <p className="text-xl">Məhsul tapılmadı</p>
              <Link href={`/${locale}/products`} className="text-primary text-sm hover:underline mt-2 block">Filtrləri sıfırla</Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
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
                <Link key={p}
                  href={`/${locale}/products?page=${p}${sale ? "&sale=true" : ""}${deal ? "&deal=true" : ""}${sortParam !== "sort_order" ? `&sort=${sortParam}` : ""}${brandParam ? `&brand=${encodeURIComponent(brandParam)}` : ""}${inStockParam ? "&instock=true" : ""}${priceMinParam ? `&pmin=${priceMinParam}` : ""}${priceMaxParam ? `&pmax=${priceMaxParam}` : ""}`}
                  className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition ${p === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}>
                  {p}
                </Link>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href}
      className={`block px-3 py-1.5 rounded-lg text-sm transition ${active ? "bg-primary text-primary-foreground font-medium" : "hover:bg-accent text-muted-foreground hover:text-foreground"}`}>
      {label}
    </Link>
  );
}
