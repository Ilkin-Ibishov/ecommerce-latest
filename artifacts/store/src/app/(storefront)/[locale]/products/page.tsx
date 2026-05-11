import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Filter } from "lucide-react";

export const metadata: Metadata = { title: "Products" };

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string; sale?: string; deal?: string; page?: string }>;
}

export default async function ProductsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { category, sale, deal, page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10));
  const pageSize = 24;
  const offset = (currentPage - 1) * pageSize;

  const supabase = await createClient();

  // Build query
  let query = supabase
    .from("products")
    .select(
      "id, slug, price, stock, is_on_sale, product_images(*), product_translations(*)",
      { count: "exact" }
    )
    .order("sort_order")
    .range(offset, offset + pageSize - 1);

  if (sale === "true") query = query.eq("is_on_sale", true);
  if (deal === "true") query = query.eq("is_deal_of_day", true);

  const { data: products = [], count } = await query;

  // Categories for filter sidebar
  const { data: categories = [] } = await supabase
    .from("categories")
    .select("id, slug, category_translations(*)")
    .is("parent_id", null);

  const totalPages = Math.ceil((count ?? 0) / pageSize);

  function getTitle(translations: { lang_code: string; title: string }[] | null) {
    return (
      translations?.find((t) => t.lang_code === locale)?.title ??
      translations?.[0]?.title ??
      "Untitled"
    );
  }

  function getFirstImage(images: { url: string }[] | null) {
    return images?.[0]?.url ?? null;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <aside className="w-full md:w-56 shrink-0">
          <div className="bg-card border border-border rounded-xl p-4 sticky top-20">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Filter size={16} /> Filters
            </h3>
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
                    {categories.map((cat) => (
                      <FilterLink
                        key={cat.id}
                        href={`/${locale}/categories/${cat.slug}`}
                        active={false}
                        label={getTitle(cat.category_translations)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Product grid */}
        <main className="flex-1">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">
              {sale === "true" ? "On Sale" : deal === "true" ? "Deals" : "All Products"}
            </h1>
            <span className="text-sm text-muted-foreground">{count ?? 0} products</span>
          </div>

          {products.length === 0 ? (
            <div className="text-center py-24 text-muted-foreground">
              <p className="text-xl">No products found</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {products.map((product) => {
                const img = getFirstImage(product.product_images);
                const title = getTitle(product.product_translations);
                return (
                  <Link
                    key={product.id}
                    href={`/${locale}/products/${product.slug}`}
                    className="group rounded-xl border border-border overflow-hidden hover:shadow-md transition"
                  >
                    <div className="relative aspect-square bg-muted overflow-hidden">
                      {img ? (
                        <Image
                          src={img}
                          alt={title}
                          fill
                          className="object-cover group-hover:scale-105 transition duration-300"
                          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                          No image
                        </div>
                      )}
                      {product.is_on_sale && (
                        <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                          SALE
                        </span>
                      )}
                      {product.stock === 0 && (
                        <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                          <span className="text-xs font-medium text-muted-foreground">Out of stock</span>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <h3 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition">
                        {title}
                      </h3>
                      <p className="font-bold text-primary mt-1">
                        {product.price.toFixed(2)} AZN
                      </p>
                      {product.stock > 0 && product.stock < 5 && (
                        <p className="text-xs text-orange-500 mt-0.5">Only {product.stock} left</p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-10">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <Link
                  key={p}
                  href={`/${locale}/products?page=${p}${sale ? "&sale=true" : ""}${deal ? "&deal=true" : ""}`}
                  className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition ${
                    p === currentPage
                      ? "bg-primary text-primary-foreground"
                      : "border border-border hover:bg-accent"
                  }`}
                >
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
    <Link
      href={href}
      className={`block px-3 py-1.5 rounded-lg text-sm transition ${
        active
          ? "bg-primary text-primary-foreground font-medium"
          : "hover:bg-accent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
