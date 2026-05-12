import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("category_translations(lang_code,title)")
    .eq("slug", slug)
    .single();
  const title =
    ((data as any)?.category_translations as any[])?.find((t: any) => t.lang_code === locale)?.title ??
    "Category";
  return { title };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  const { page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10));
  const pageSize = 24;
  const offset = (currentPage - 1) * pageSize;

  const supabase = await createClient();

  const { data: catRaw } = await supabase
    .from("categories")
    .select("*, category_translations(*)")
    .eq("slug", slug)
    .single();

  if (!catRaw) notFound();
  const category = catRaw as any;

  const catTitle =
    (category.category_translations as any[]).find((t: any) => t.lang_code === locale)?.title ??
    (category.category_translations as any[])[0]?.title ??
    "Category";

  const { data: rowsRaw, count } = await supabase
    .from("product_categories")
    .select(
      "products(id, slug, price, stock, is_on_sale, product_images(*), product_translations(*))",
      { count: "exact" }
    )
    .eq("category_id", category.id)
    .range(offset, offset + pageSize - 1);

  const rows = (rowsRaw ?? []) as any[];
  const products = rows.map((r) => r.products).filter(Boolean);
  const totalPages = Math.ceil((count ?? 0) / pageSize);

  function getTitle(translations: any[] | null) {
    return (
      translations?.find((t) => t.lang_code === locale)?.title ??
      translations?.[0]?.title ??
      "Untitled"
    );
  }

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
        <span className="text-sm text-muted-foreground">{count ?? 0} products</span>
      </div>

      {products.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <p className="text-xl">No products in this category yet</p>
          <Link href={`/${locale}/products`} className="text-primary text-sm hover:underline mt-2 block">
            Browse all products
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {products.map((product: any) => {
            const img = (product.product_images as any[])?.[0]?.url ?? null;
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
                      sizes="(max-width: 640px) 50vw, 25vw"
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
                </div>
                <div className="p-3">
                  <h3 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition">{title}</h3>
                  <p className="font-bold text-primary mt-1">{product.price.toFixed(2)} AZN</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-10">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/${locale}/categories/${slug}?page=${p}`}
              className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition ${
                p === currentPage ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"
              }`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
