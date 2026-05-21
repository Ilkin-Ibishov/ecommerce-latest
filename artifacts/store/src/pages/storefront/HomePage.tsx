import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import ProductCard from "@/components/storefront/ProductCard";
import { ProductSkeletonGrid } from "@/components/storefront/ProductSkeleton";

function ProductGrid({ title, products, locale, showSaleBadge }: {
  title: string; products: any[]; locale: string; showSaleBadge?: boolean;
}) {
  return (
    <section>
      <h2 className="text-2xl font-bold mb-6">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {products.map((product: any) => {
          const name = product.product_translations?.find((t: any) => t.lang_code === locale)?.title
            ?? product.product_translations?.[0]?.title ?? "Product";
          return (
            <ProductCard
              key={product.id}
              slug={product.slug}
              title={name}
              price={product.price}
              image={product.product_images?.[0]?.url ?? null}
              isOnSale={showSaleBadge || product.is_on_sale}
              isDealOfDay={product.is_deal_of_day}
              stock={product.stock}
              locale={locale}
            />
          );
        })}
      </div>
    </section>
  );
}

function SetupBanner() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-10 text-center">
      <div className="text-4xl mb-4">🛍️</div>
      <h2 className="text-2xl font-bold mb-2">Store is ready — connect your database</h2>
      <p className="text-muted-foreground mb-4 max-w-lg mx-auto">
        Set <code className="bg-muted px-1 rounded">VITE_SUPABASE_URL</code> and{" "}
        <code className="bg-muted px-1 rounded">VITE_SUPABASE_ANON_KEY</code> in your environment variables to connect to your Supabase project.
      </p>
      <p className="text-sm text-muted-foreground">
        Also set <code className="bg-muted px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> on the API server for full admin functionality.
      </p>
    </div>
  );
}

export default function HomePage({ locale }: { locale: string }) {
  const { t } = useI18n();
  const [featured, setFeatured] = useState<any[]>([]);
  const [onSale, setOnSale] = useState<any[]>([]);
  const [dealOfDay, setDealOfDay] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    const supabase = createClient();
    async function load() {
      const [featRes, saleRes, dealRes, catRes] = await Promise.all([
        supabase.from("products").select("*, product_images(*), product_translations(*)").eq("is_featured", true).order("sort_order").limit(8),
        supabase.from("products").select("*, product_images(*), product_translations(*)").eq("is_on_sale", true).order("sort_order").limit(8),
        supabase.from("products").select("*, product_images(*), product_translations(*)").eq("is_deal_of_day", true).order("sort_order").limit(1).maybeSingle(),
        supabase.from("categories").select("*, category_translations(*)").is("parent_id", null).limit(12),
      ]);
      setFeatured(featRes.data ?? []);
      setOnSale(saleRes.data ?? []);
      setDealOfDay(dealRes.data ?? null);
      setCategories(catRes.data ?? []);
      setLoading(false);
    }
    load();
  }, [configured]);

  if (loading) return (
    <div className="container mx-auto px-4 py-8 space-y-12">
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary/70 h-56 shimmer opacity-40" />
      <ProductSkeletonGrid count={8} className="grid-cols-2 sm:grid-cols-3 md:grid-cols-4" />
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8 space-y-12">
      <section className="relative rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground p-10 md:p-16 text-center overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-3xl md:text-5xl font-bold mb-4">{t("HomePage.hero.title")}</h1>
          <p className="text-lg md:text-xl opacity-90 mb-8">{t("HomePage.hero.subtitle")}</p>
          <Link
            href={`/${locale}/products`}
            className="btn-hero inline-block bg-white text-primary font-semibold px-8 py-3 rounded-full hover:bg-white/90 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200"
          >
            {t("HomePage.hero.cta")}
          </Link>
        </div>
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-20 -left-10 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
      </section>

      {!configured && <SetupBanner />}

      {categories.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-6">{t("HomePage.sections.categories")}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {categories.map((cat: any) => {
              const title = cat.category_translations?.find((t: any) => t.lang_code === locale)?.title
                ?? cat.category_translations?.[0]?.title ?? "Category";
              return (
                <Link key={cat.id} href={`/${locale}/categories/${cat.slug}`}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-accent hover:-translate-y-1 transition-all duration-200 group">
                  {cat.icon_url ? (
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-muted">
                      <img src={cat.icon_url} alt={title} className="object-cover w-full h-full" />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-xl group-hover:scale-110 transition-transform duration-200">🛍️</div>
                  )}
                  <span className="text-sm font-medium text-center group-hover:text-primary transition">{title}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {dealOfDay && (
        <section>
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <span className="text-orange-500">🔥</span>{t("HomePage.sections.dealOfDay")}
          </h2>
          <Link href={`/${locale}/products/${dealOfDay.slug}`}
            className="product-card block rounded-2xl border border-orange-200 bg-orange-50 hover:bg-orange-100 transition overflow-hidden">
            <div className="flex flex-col md:flex-row gap-6 p-6">
              {dealOfDay.product_images?.[0]?.url && (
                <div className="w-full md:w-64 h-48 md:h-auto rounded-xl overflow-hidden bg-white shrink-0">
                  <img src={dealOfDay.product_images[0].url} alt=""
                    className="product-card-img object-cover w-full h-full" />
                </div>
              )}
              <div className="flex-1 flex flex-col justify-center">
                <span className="text-xs font-semibold uppercase tracking-wide text-orange-600 mb-2">{t("HomePage.sections.dealOfDay")}</span>
                <h3 className="text-2xl font-bold mb-2">
                  {dealOfDay.product_translations?.find((tr: any) => tr.lang_code === locale)?.title
                    ?? dealOfDay.product_translations?.[0]?.title ?? "Product"}
                </h3>
                <p className="text-3xl font-bold text-primary">{Number(dealOfDay.price).toFixed(2)} AZN</p>
              </div>
            </div>
          </Link>
        </section>
      )}

      {featured.length > 0 && (
        <ProductGrid title={t("HomePage.sections.featured")} products={featured} locale={locale} />
      )}
      {onSale.length > 0 && (
        <ProductGrid title={t("HomePage.sections.onSale")} products={onSale} locale={locale} showSaleBadge />
      )}

      {configured && featured.length === 0 && onSale.length === 0 && (
        <div className="text-center py-24">
          <h2 className="text-2xl font-bold mb-2">{t("HomePage.empty.title")}</h2>
          <p className="text-muted-foreground">{t("HomePage.empty.subtitle")}</p>
        </div>
      )}
    </div>
  );
}
