import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import Image from "next/image";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("HomePage");
  const supabase = await createClient();

  const [featuredRes, saleRes, dealRes, categoriesRes] = await Promise.all([
    supabase
      .from("products")
      .select(`*, product_images(*), product_translations(*)`)
      .eq("is_featured", true)
      .order("sort_order")
      .limit(8),
    supabase
      .from("products")
      .select(`*, product_images(*), product_translations(*)`)
      .eq("is_on_sale", true)
      .order("sort_order")
      .limit(8),
    supabase
      .from("products")
      .select(`*, product_images(*), product_translations(*)`)
      .eq("is_deal_of_day", true)
      .order("sort_order")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("categories")
      .select(`*, category_translations(*)`)
      .is("parent_id", null)
      .limit(12),
  ]);

  const featured = featuredRes.data ?? [];
  const onSale = saleRes.data ?? [];
  const dealOfDay = dealRes.data;
  const categories = categoriesRes.data ?? [];

  function getTitle(
    translations: { lang_code: string; title: string }[] | null
  ) {
    if (!translations) return "";
    return (
      translations.find((t) => t.lang_code === locale)?.title ??
      translations[0]?.title ??
      ""
    );
  }

  function getFirstImage(images: { url: string; alt_text: string | null }[] | null) {
    return images?.[0]?.url ?? null;
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-12">
      {/* Hero Banner */}
      <section className="rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground p-10 md:p-16 text-center">
        <h1 className="text-3xl md:text-5xl font-bold mb-4">
          {t("hero.title")}
        </h1>
        <p className="text-lg md:text-xl opacity-90 mb-8">
          {t("hero.subtitle")}
        </p>
        <Link
          href={`/${locale}/products`}
          className="inline-block bg-white text-primary font-semibold px-8 py-3 rounded-full hover:bg-white/90 transition"
        >
          {t("hero.cta")}
        </Link>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-6">{t("sections.categories")}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/${locale}/categories/${cat.slug}`}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-accent transition group"
              >
                {cat.icon_url && (
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-muted">
                    <Image
                      src={cat.icon_url}
                      alt={getTitle(cat.category_translations)}
                      width={48}
                      height={48}
                      className="object-cover w-full h-full"
                    />
                  </div>
                )}
                <span className="text-sm font-medium text-center group-hover:text-primary transition">
                  {getTitle(cat.category_translations)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Deal of the Day */}
      {dealOfDay && (
        <section>
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <span className="text-orange-500">🔥</span>
            {t("sections.dealOfDay")}
          </h2>
          <Link
            href={`/${locale}/products/${dealOfDay.slug}`}
            className="block rounded-2xl border border-orange-200 bg-orange-50 hover:bg-orange-100 transition overflow-hidden"
          >
            <div className="flex flex-col md:flex-row gap-6 p-6">
              {getFirstImage(dealOfDay.product_images) && (
                <div className="w-full md:w-64 h-48 md:h-auto rounded-xl overflow-hidden bg-white shrink-0">
                  <Image
                    src={getFirstImage(dealOfDay.product_images)!}
                    alt={getTitle(dealOfDay.product_translations)}
                    width={256}
                    height={256}
                    className="object-cover w-full h-full"
                  />
                </div>
              )}
              <div className="flex-1 flex flex-col justify-center">
                <span className="text-xs font-semibold uppercase tracking-wide text-orange-600 mb-2">
                  {t("sections.dealOfDay")}
                </span>
                <h3 className="text-2xl font-bold mb-2">
                  {getTitle(dealOfDay.product_translations)}
                </h3>
                <p className="text-3xl font-bold text-primary">
                  {dealOfDay.price.toFixed(2)} AZN
                </p>
              </div>
            </div>
          </Link>
        </section>
      )}

      {/* Featured Products */}
      {featured.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-6">{t("sections.featured")}</h2>
          <ProductGrid products={featured} locale={locale} getTitle={getTitle} getFirstImage={getFirstImage} />
        </section>
      )}

      {/* On Sale */}
      {onSale.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">{t("sections.onSale")}</h2>
            <Link href={`/${locale}/products?sale=true`} className="text-primary text-sm hover:underline">
              {t("sections.viewAll")}
            </Link>
          </div>
          <ProductGrid products={onSale} locale={locale} getTitle={getTitle} getFirstImage={getFirstImage} showSaleBadge />
        </section>
      )}

      {/* Empty state */}
      {featured.length === 0 && onSale.length === 0 && !dealOfDay && (
        <div className="text-center py-24 text-muted-foreground">
          <p className="text-xl">{t("empty.title")}</p>
          <p className="text-sm mt-2">{t("empty.subtitle")}</p>
        </div>
      )}
    </div>
  );
}

function ProductGrid({
  products,
  locale,
  getTitle,
  getFirstImage,
  showSaleBadge = false,
}: {
  products: any[];
  locale: string;
  getTitle: (t: any) => string;
  getFirstImage: (i: any) => string | null;
  showSaleBadge?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
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
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                  No image
                </div>
              )}
              {showSaleBadge && (
                <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  SALE
                </span>
              )}
            </div>
            <div className="p-3">
              <h3 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition">
                {title}
              </h3>
              <p className="font-bold text-primary mt-1">
                {product.price.toFixed(2)} AZN
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
