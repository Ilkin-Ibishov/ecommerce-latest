import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;

  if (!q?.trim()) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground">Enter a search term to find products.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: results = [] } = await supabase.rpc("search_products", {
    query_text: q,
    lang_code: locale,
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Search results for "{q}"</h1>
      <p className="text-muted-foreground mb-8">{results.length} results found</p>

      {results.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No products found for "{q}"</p>
          <Link href={`/${locale}/products`} className="text-primary text-sm hover:underline mt-2 block">
            Browse all products
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {results.map((product) => (
            <Link
              key={product.id}
              href={`/${locale}/products/${product.slug}`}
              className="group rounded-xl border border-border overflow-hidden hover:shadow-md transition"
            >
              <div className="aspect-square bg-muted flex items-center justify-center text-muted-foreground text-xs">
                No image
              </div>
              <div className="p-3">
                <h3 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition">
                  {product.title}
                </h3>
                <p className="font-bold text-primary mt-1">
                  {product.price.toFixed(2)} AZN
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
