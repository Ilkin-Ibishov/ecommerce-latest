import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";

export default function CategoriesPage({ locale }: { locale: string }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("categories")
      .select("*, category_translations(*), subcategories:categories!parent_id(id, slug, category_translations(*))")
      .is("parent_id", null)
      .then(({ data }: any) => { setCategories(data ?? []); setLoading(false); });
  }, []);

  const getTitle = (translations: any[] | null) =>
    translations?.find((t: any) => t.lang_code === locale)?.title ?? translations?.[0]?.title ?? "Untitled";

  if (loading) return <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">Yüklənir…</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-8">Kateqoriyalar</h1>
      {categories.length === 0 ? (
        <p className="text-muted-foreground text-center py-16">Kateqoriya yoxdur</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {categories.map((cat) => {
            const subs: any[] = cat.subcategories ?? [];
            return (
              <div key={cat.id} className="rounded-2xl border border-border bg-card overflow-hidden hover:shadow-md transition">
                <Link
                  href={`/${locale}/categories/${cat.slug}`}
                  className="flex items-center gap-4 p-4 hover:bg-accent transition group"
                >
                  {cat.icon_url ? (
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-muted shrink-0">
                      <img src={cat.icon_url} alt={getTitle(cat.category_translations)} className="object-cover w-full h-full" />
                    </div>
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-2xl shrink-0 group-hover:scale-110 transition-transform duration-200">
                      🛍️
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold group-hover:text-primary transition line-clamp-1">
                      {getTitle(cat.category_translations)}
                    </h2>
                    {subs.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">{subs.length} alt kateqoriya</p>
                    )}
                  </div>
                  <span className="text-muted-foreground text-lg">›</span>
                </Link>

                {subs.length > 0 && (
                  <div className="px-4 pb-3 pt-0 flex flex-wrap gap-1.5 border-t border-border bg-muted/30">
                    {subs.slice(0, 5).map((sub: any) => (
                      <Link
                        key={sub.id}
                        href={`/${locale}/categories/${sub.slug}`}
                        className="text-xs px-2.5 py-1 rounded-full bg-background border border-border hover:border-primary hover:text-primary transition"
                      >
                        {getTitle(sub.category_translations)}
                      </Link>
                    ))}
                    {subs.length > 5 && (
                      <Link
                        href={`/${locale}/categories/${cat.slug}`}
                        className="text-xs px-2.5 py-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground transition"
                      >
                        +{subs.length - 5} daha
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
