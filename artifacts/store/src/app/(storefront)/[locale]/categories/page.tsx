import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();

  const { data: categories = [] } = await supabase
    .from("categories")
    .select("*, category_translations(*)")
    .is("parent_id", null);

  function getTitle(translations: { lang_code: string; title: string }[] | null) {
    return (
      translations?.find((t) => t.lang_code === locale)?.title ??
      translations?.[0]?.title ??
      "Untitled"
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-8">Categories</h1>
      {categories.length === 0 ? (
        <p className="text-muted-foreground text-center py-16">No categories yet</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/${locale}/categories/${cat.slug}`}
              className="group flex flex-col items-center gap-3 p-5 rounded-2xl border border-border hover:border-primary/40 hover:bg-accent transition"
            >
              {cat.icon_url ? (
                <div className="w-16 h-16 rounded-full overflow-hidden bg-muted">
                  <Image
                    src={cat.icon_url}
                    alt={getTitle(cat.category_translations)}
                    width={64}
                    height={64}
                    className="object-cover w-full h-full"
                  />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl">
                  🛍️
                </div>
              )}
              <span className="text-sm font-medium text-center group-hover:text-primary transition">
                {getTitle(cat.category_translations)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
