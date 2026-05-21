import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Filter } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ProductCard from "@/components/storefront/ProductCard";
import { ProductSkeletonGrid } from "@/components/storefront/ProductSkeleton";

export default function ProductsPage({ locale }: { locale: string }) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const sale = params.get("sale");
  const deal = params.get("deal");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const pageSize = 24;
  const offset = (page - 1) * pageSize;

  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      setLoading(true);
      let query = (supabase as any)
        .from("products")
        .select("id, slug, price, stock, is_on_sale, is_deal_of_day, product_images(*), product_translations(*)", { count: "exact" })
        .order("sort_order")
        .range(offset, offset + pageSize - 1);
      if (sale === "true") query = query.eq("is_on_sale", true);
      if (deal === "true") query = query.eq("is_deal_of_day", true);
      const { data, count: total } = await query;
      setProducts(data ?? []);
      setCount(total ?? 0);

      const { data: cats } = await supabase.from("categories")
        .select("id, slug, category_translations(*)").is("parent_id", null);
      setCategories(cats ?? []);
      setLoading(false);
    }
    load();
  }, [sale, deal, page]);

  const getTitle = (translations: any[] | null) =>
    translations?.find((t: any) => t.lang_code === locale)?.title ?? translations?.[0]?.title ?? "Untitled";

  const totalPages = Math.ceil(count / pageSize);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row gap-8">
        <aside className="w-full md:w-56 shrink-0">
          <div className="bg-card border border-border rounded-xl p-4 sticky top-20">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Filter size={16} /> Filters</h3>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Type</p>
                <div className="space-y-1">
                  <FilterLink href={`/${locale}/products`} active={!sale && !deal} label="All Products" />
                  <FilterLink href={`/${locale}/products?sale=true`} active={sale === "true"} label="On Sale" />
                  <FilterLink href={`/${locale}/products?deal=true`} active={deal === "true"} label="Deal of the Day" />
                </div>
              </div>
              {categories.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Category</p>
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

        <main className="flex-1">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">
              {sale === "true" ? "On Sale" : deal === "true" ? "Deals" : "All Products"}
            </h1>
            <span className="text-sm text-muted-foreground">{loading ? "…" : `${count} products`}</span>
          </div>

          {loading ? (
            <ProductSkeletonGrid count={12} />
          ) : products.length === 0 ? (
            <div className="text-center py-24 text-muted-foreground">
              <p className="text-xl">No products found</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
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
                  href={`/${locale}/products?page=${p}${sale ? "&sale=true" : ""}${deal ? "&deal=true" : ""}`}
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
