import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Filter, ArrowUpDown, ChevronDown } from "lucide-react";
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
  const pageSize = 24;
  const offset = (page - 1) * pageSize;

  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      setLoading(true);
      let query = (supabase as any)
        .from("products")
        .select("id, slug, price, stock, is_on_sale, is_deal_of_day, product_images(*), product_translations(*)", { count: "exact" })
        .range(offset, offset + pageSize - 1);

      if (sale === "true") query = query.eq("is_on_sale", true);
      if (deal === "true") query = query.eq("is_deal_of_day", true);

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
      setLoading(false);
    }
    load();
  }, [sale, deal, page, sortParam]);

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

  const currentSort = SORT_OPTIONS.find((o) => o.value === sortParam) ?? SORT_OPTIONS[0];

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8">

      {/* Mobile filter/sort bar */}
      <div className="flex items-center gap-2 mb-4 md:hidden">
        <button
          onClick={() => setFilterOpen(!filterOpen)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent transition"
        >
          <Filter size={15} /> Filtr
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
        <div className="md:hidden bg-card border border-border rounded-xl p-4 mb-4 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Növ</p>
            <div className="grid grid-cols-3 gap-2">
              <FilterLink href={buildUrl({ sale: null, deal: null })} active={!sale && !deal} label="Hamısı" />
              <FilterLink href={buildUrl({ sale: "true", deal: null })} active={sale === "true"} label="Endirimli" />
              <FilterLink href={buildUrl({ deal: "true", sale: null })} active={deal === "true"} label="Günün təklifi" />
            </div>
          </div>
          {categories.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Kateqoriya</p>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat: any) => (
                  <Link key={cat.id} href={`/${locale}/categories/${cat.slug}`}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm hover:border-primary hover:text-primary transition">
                    {getTitle(cat.category_translations)}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-8">
        {/* Desktop sidebar */}
        <aside className="hidden md:block w-56 shrink-0">
          <div className="bg-card border border-border rounded-xl p-4 sticky top-20">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Filter size={16} /> Filtrlər</h3>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Növ</p>
                <div className="space-y-1">
                  <FilterLink href={buildUrl({ sale: null, deal: null })} active={!sale && !deal} label="Bütün məhsullar" />
                  <FilterLink href={buildUrl({ sale: "true", deal: null })} active={sale === "true"} label="Endirimli" />
                  <FilterLink href={buildUrl({ deal: "true", sale: null })} active={deal === "true"} label="Günün təklifi" />
                </div>
              </div>
              {categories.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Kateqoriya</p>
                  <div className="space-y-1">
                    {categories.map((cat: any) => (
                      <FilterLink key={cat.id} href={`/${locale}/categories/${cat.slug}`}
                        active={false} label={getTitle(cat.category_translations)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4 sm:mb-6 gap-3">
            <h1 className="text-xl sm:text-2xl font-bold">
              {sale === "true" ? "Endirimli məhsullar" : deal === "true" ? "Günün təklifi" : "Bütün məhsullar"}
            </h1>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground hidden sm:block">{loading ? "…" : `${count} məhsul`}</span>
              {/* Desktop sort */}
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

          {loading ? (
            <BouncingLoader label="Yüklənir…" className="py-32" />
          ) : products.length === 0 ? (
            <div className="text-center py-24 text-muted-foreground">
              <p className="text-xl">Məhsul tapılmadı</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {products.map((product: any) => (
                <ProductCard
                  key={product.id}
                  slug={product.slug}
                  title={getTitle(product.product_translations)}
                  price={product.price}
                  image={product.product_images?.[0]?.url ?? null}
                  isOnSale={product.is_on_sale}
                  isDealOfDay={product.is_deal_of_day}
                  stock={product.stock}
                  locale={locale}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-10">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <Link key={p}
                  href={`/${locale}/products?page=${p}${sale ? "&sale=true" : ""}${deal ? "&deal=true" : ""}${sortParam !== "sort_order" ? `&sort=${sortParam}` : ""}`}
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
