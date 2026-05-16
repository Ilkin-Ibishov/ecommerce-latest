import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { createClient } from "@/lib/supabase/client";

export default function CategoryPage({ locale, slug }: { locale: string; slug: string }) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const pageSize = 24;
  const offset = (page - 1) * pageSize;

  const [category, setCategory] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data: cat } = await supabase.from("categories")
        .select("*, category_translations(*)").eq("slug", slug).single();
      if (!cat) { setNotFound(true); setLoading(false); return; }
      setCategory(cat);

      const { data: rows, count: total } = await (supabase as any)
        .from("product_categories")
        .select("products(id, slug, price, stock, is_on_sale, product_images(*), product_translations(*))", { count: "exact" })
        .eq("category_id", cat.id)
        .range(offset, offset + pageSize - 1);
      setProducts((rows ?? []).map((r: any) => r.products).filter(Boolean));
      setCount(total ?? 0);
      setLoading(false);
    }
    load();
  }, [slug, page]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">Loading...</div>;
  if (notFound) return (
    <div className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold mb-4">Category not found</h1>
      <Link href={`/${locale}/categories`} className="text-primary hover:underline">Back to categories</Link>
    </div>
  );

  const catTitle = category.category_translations?.find((t: any) => t.lang_code === locale)?.title
    ?? category.category_translations?.[0]?.title ?? "Category";
  const getTitle = (translations: any[]) =>
    translations?.find((t: any) => t.lang_code === locale)?.title ?? translations?.[0]?.title ?? "Untitled";
  const totalPages = Math.ceil(count / pageSize);

  return (
    <div className="container mx-auto px-4 py-8">
      <nav className="text-sm text-muted-foreground mb-6">
        <Link href={`/${locale}`} className="hover:text-foreground">Home</Link>
        <span className="mx-2">/</span>
        <Link href={`/${locale}/categories`} className="hover:text-foreground">Categories</Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{catTitle}</span>
      </nav>

      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">{catTitle}</h1>
        <span className="text-sm text-muted-foreground">{count} products</span>
      </div>

      {products.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <p className="text-xl">No products in this category yet</p>
          <Link href={`/${locale}/products`} className="text-primary text-sm hover:underline mt-2 block">Browse all products</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {products.map((product: any) => {
            const img = product.product_images?.[0]?.url ?? null;
            const title = getTitle(product.product_translations);
            return (
              <Link key={product.id} href={`/${locale}/products/${product.slug}`}
                className="group rounded-xl border border-border overflow-hidden hover:shadow-md transition">
                <div className="relative aspect-square bg-muted overflow-hidden">
                  {img ? <img src={img} alt={title} className="object-cover w-full h-full group-hover:scale-105 transition duration-300" />
                    : <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No image</div>}
                  {product.is_on_sale && <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">SALE</span>}
                </div>
                <div className="p-3">
                  <h3 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition">{title}</h3>
                  <p className="font-bold text-primary mt-1">{Number(product.price).toFixed(2)} AZN</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-10">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/${locale}/categories/${slug}?page=${p}`}
              className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition ${p === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}>
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
