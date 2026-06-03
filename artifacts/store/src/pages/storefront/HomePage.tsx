import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import ProductCard from "@/components/storefront/ProductCard";
import BouncingLoader from "@/components/ui/BouncingLoader";
import TrustBadges from "@/components/storefront/TrustBadges";
import HeroCarousel from "@/components/storefront/HeroCarousel";

const BRAND_LOGOS: Array<{ name: string; logo: string }> = [
  { name: "Apple",    logo: "https://cdn.simpleicons.org/apple/222222" },
  { name: "Samsung",  logo: "https://cdn.simpleicons.org/samsung/222222" },
  { name: "Xiaomi",   logo: "https://cdn.simpleicons.org/xiaomi/222222" },
  { name: "Huawei",   logo: "https://cdn.simpleicons.org/huawei/222222" },
  { name: "Sony",     logo: "https://cdn.simpleicons.org/sony/222222" },
  { name: "LG",       logo: "https://cdn.simpleicons.org/lg/222222" },
  { name: "Lenovo",   logo: "https://cdn.simpleicons.org/lenovo/222222" },
  { name: "HP",       logo: "https://cdn.simpleicons.org/hp/222222" },
  { name: "Asus",     logo: "https://cdn.simpleicons.org/asus/222222" },
  { name: "Acer",     logo: "https://cdn.simpleicons.org/acer/222222" },
  { name: "Dell",     logo: "https://cdn.simpleicons.org/dell/222222" },
  { name: "OnePlus",  logo: "https://cdn.simpleicons.org/oneplus/222222" },
  { name: "Logitech",  logo: "https://cdn.simpleicons.org/logitech/222222" },
  { name: "Microsoft", logo: "https://cdn.simpleicons.org/microsoft/222222" },
  { name: "Intel",     logo: "https://cdn.simpleicons.org/intel/222222" },
  { name: "Nvidia",    logo: "https://cdn.simpleicons.org/nvidia/222222" },
  { name: "AMD",       logo: "https://cdn.simpleicons.org/amd/222222" },
  { name: "Razer",     logo: "https://cdn.simpleicons.org/razer/222222" },
];

function useCountdown(targetHour = 0) {
  const getSecondsLeft = useCallback(() => {
    const now = new Date();
    const target = new Date(now);
    target.setHours(targetHour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  }, [targetHour]);

  const [seconds, setSeconds] = useState(getSecondsLeft);

  useEffect(() => {
    const interval = setInterval(() => setSeconds(getSecondsLeft()), 1000);
    return () => clearInterval(interval);
  }, [getSecondsLeft]);

  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return { h, m, s };
}

function CountdownUnit({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xl sm:text-2xl font-mono font-bold tabular-nums bg-black/20 px-2 py-0.5 rounded-lg min-w-[2.5rem] text-center">
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide mt-0.5 opacity-70">{label}</span>
    </div>
  );
}

function ProductGrid({ title, products, locale, showSaleBadge }: {
  title: string; products: any[]; locale: string; showSaleBadge?: boolean;
}) {
  return (
    <section>
      <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
        {products.map((product: any) => {
          const name = product.product_translations?.find((t: any) => t.lang_code === locale)?.title
            ?? product.product_translations?.[0]?.title ?? "Product";
          return (
            <ProductCard
              key={product.id}
              productId={product.id}
              slug={product.slug}
              title={name}
              price={product.price}
              originalPrice={product.original_price}
              image={product.product_images?.[0]?.url ?? null}
              isOnSale={showSaleBadge || product.is_on_sale}
              isDealOfDay={product.is_deal_of_day}
              stock={product.stock}
              brand={product.brand}
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
  const countdown = useCountdown(0);

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
    <div className="container mx-auto px-4">
      <BouncingLoader label="Yüklənir…" className="min-h-[60vh]" />
    </div>
  );

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-8 sm:space-y-12">

      {/* Hero Carousel (falls back to static hero if no banners) */}
      <HeroCarousel locale={locale} />

      {/* Trust badges */}
      <TrustBadges />

      {!configured && <SetupBanner />}

      {/* Brand logos strip — auto-scrolling marquee */}
      <section className="overflow-hidden">
        <div className="animate-marquee flex items-center" style={{ width: "max-content" }}>
          {[...BRAND_LOGOS, ...BRAND_LOGOS].map((b, i) => (
            <Link
              key={`${b.name}-${i}`}
              href={`/${locale}/products?brand=${encodeURIComponent(b.name)}`}
              className="shrink-0 group flex items-center justify-center h-10 w-24 sm:h-12 sm:w-28 mx-5 sm:mx-8 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-200"
              title={b.name}
            >
              <img
                src={b.logo}
                alt={b.name}
                className="max-h-full max-w-full object-contain"
                loading="eager"
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
              />
            </Link>
          ))}
        </div>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section>
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">{t("HomePage.sections.categories")}</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 sm:gap-4">
            {categories.map((cat: any) => {
              const title = cat.category_translations?.find((t: any) => t.lang_code === locale)?.title
                ?? cat.category_translations?.[0]?.title ?? "Category";
              return (
                <Link key={cat.id} href={`/${locale}/categories/${cat.slug}`}
                  className="flex flex-col items-center gap-1.5 sm:gap-2 p-2.5 sm:p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-accent hover:-translate-y-1 transition-all duration-200 group">
                  {cat.icon_url ? (
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden bg-muted">
                      <img src={cat.icon_url} alt={title} className="object-cover w-full h-full" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg sm:text-xl group-hover:scale-110 transition-transform duration-200">🛍️</div>
                  )}
                  <span className="text-[11px] sm:text-sm font-medium text-center leading-tight group-hover:text-primary transition line-clamp-2">{title}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Deal of Day with countdown */}
      {dealOfDay && (
        <section>
          <div className="flex items-center justify-between mb-4 sm:mb-6 flex-wrap gap-3">
            <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <span className="text-orange-500">🔥</span>{t("HomePage.sections.dealOfDay")}
            </h2>
            <div className="flex items-center gap-2 text-orange-600">
              <span className="text-xs font-medium opacity-80">Bitməsinə:</span>
              <div className="flex items-center gap-1.5">
                <CountdownUnit value={countdown.h} label="saat" />
                <span className="font-bold text-xl mb-3">:</span>
                <CountdownUnit value={countdown.m} label="dəq" />
                <span className="font-bold text-xl mb-3">:</span>
                <CountdownUnit value={countdown.s} label="san" />
              </div>
            </div>
          </div>
          <Link href={`/${locale}/products/${dealOfDay.slug}`}
            className="product-card block rounded-2xl border border-orange-200 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/20 dark:border-orange-900/40 transition overflow-hidden">
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 p-4 sm:p-6">
              {dealOfDay.product_images?.[0]?.url && (
                <div className="w-full sm:w-56 h-44 sm:h-48 rounded-xl overflow-hidden bg-white shrink-0">
                  <img src={dealOfDay.product_images[0].url} alt=""
                    className="product-card-img object-cover w-full h-full" />
                </div>
              )}
              <div className="flex-1 flex flex-col justify-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-orange-600">{t("HomePage.sections.dealOfDay")}</span>
                <h3 className="text-xl sm:text-2xl font-bold">
                  {dealOfDay.product_translations?.find((tr: any) => tr.lang_code === locale)?.title
                    ?? dealOfDay.product_translations?.[0]?.title ?? "Product"}
                </h3>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-2xl sm:text-3xl font-bold text-primary">{Number(dealOfDay.price).toFixed(2)} AZN</p>
                  {dealOfDay.original_price && dealOfDay.original_price > dealOfDay.price && (
                    <p className="text-base text-muted-foreground line-through">{Number(dealOfDay.original_price).toFixed(2)} AZN</p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Ayda <span className="font-semibold text-foreground">{(dealOfDay.price / 12).toFixed(2)} AZN</span> — 12 aya
                </p>
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
