import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { createClient } from "@/lib/supabase/client";

export default function SearchPage({ locale }: { locale: string }) {
  const search = useSearch();
  const q = new URLSearchParams(search).get("q") ?? "";
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q.trim()) return;
    setLoading(true);
    const supabase = createClient();
    (supabase as any).rpc("search_products", { query_text: q, lang_code: locale })
      .then(({ data }: any) => { setResults(data ?? []); setLoading(false); });
  }, [q, locale]);

  if (!q.trim()) return (
    <div className="container mx-auto px-4 py-16 text-center">
      <p className="text-muted-foreground">Enter a search term to find products.</p>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Search results for &ldquo;{q}&rdquo;</h1>
      <p className="text-muted-foreground mb-8">{results.length} results found</p>

      {loading ? (
        <div className="text-center py-24 text-muted-foreground">Searching...</div>
      ) : results.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No products found for &ldquo;{q}&rdquo;</p>
          <Link href={`/${locale}/products`} className="text-primary text-sm hover:underline mt-2 block">Browse all products</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {results.map((product: any) => (
            <Link key={product.id} href={`/${locale}/products/${product.slug}`}
              className="group rounded-xl border border-border overflow-hidden hover:shadow-md transition">
              <div className="aspect-square bg-muted flex items-center justify-center text-muted-foreground text-xs">No image</div>
              <div className="p-3">
                <h3 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition">{product.title}</h3>
                <p className="font-bold text-primary mt-1">{Number(product.price).toFixed(2)} AZN</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
