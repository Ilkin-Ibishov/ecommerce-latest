import { useEffect, useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n/context";

interface Banner {
  id: string;
  title: string;
  subtitle?: string;
  image_url?: string;
  cta_text?: string;
  cta_url?: string;
  sort_order: number;
}

const AUTOPLAY_MS = 5000;

interface HeroCarouselProps {
  locale: string;
}

export default function HeroCarousel({ locale }: HeroCarouselProps) {
  const { t } = useI18n();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(apiUrl("/banners"))
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => { if (Array.isArray(data) && data.length > 0) setBanners(data); })
      .catch(() => {});
  }, []);

  const next = useCallback(() => setCurrent((c) => (c + 1) % (banners.length || 1)), [banners.length]);
  const prev = useCallback(() => setCurrent((c) => (c - 1 + banners.length) % (banners.length || 1)), [banners.length]);

  useEffect(() => {
    if (paused || banners.length <= 1) return;
    timerRef.current = setTimeout(next, AUTOPLAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [current, paused, banners.length, next]);

  useEffect(() => {
    if (current >= banners.length && banners.length > 0) setCurrent(0);
  }, [banners.length, current]);

  if (banners.length === 0) {
    return (
      <section className="relative rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground p-7 sm:p-10 md:p-16 text-center overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-3 sm:mb-4">{t("HomePage.hero.title")}</h1>
          <p className="text-base sm:text-lg md:text-xl opacity-90 mb-6 sm:mb-8">{t("HomePage.hero.subtitle")}</p>
          <Link
            href={`/${locale}/products`}
            className="inline-block bg-white text-primary font-semibold px-7 sm:px-8 py-2.5 sm:py-3 rounded-full hover:bg-white/90 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 text-sm sm:text-base"
          >
            {t("HomePage.hero.cta")}
          </Link>
        </div>
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-20 -left-10 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
      </section>
    );
  }

  const banner = banners[current];

  return (
    <section
      className="relative rounded-2xl overflow-hidden h-52 sm:h-72 md:h-96 select-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {banners.map((b, i) => (
        <div
          key={b.id}
          className={`absolute inset-0 transition-opacity duration-700 ${i === current ? "opacity-100 z-10" : "opacity-0 z-0"}`}
        >
          {b.image_url ? (
            <img
              src={b.image_url}
              alt={b.title}
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary to-primary/60" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        </div>
      ))}

      <div className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-8 sm:pb-10 px-6 text-center text-white">
        <h2 className="text-xl sm:text-3xl md:text-4xl font-bold mb-2 drop-shadow-md line-clamp-2">{banner.title}</h2>
        {banner.subtitle && (
          <p className="text-sm sm:text-base opacity-90 mb-4 drop-shadow line-clamp-2">{banner.subtitle}</p>
        )}
        {banner.cta_text && banner.cta_url && (
          <Link
            href={banner.cta_url.startsWith("/") ? banner.cta_url : `/${locale}/${banner.cta_url.replace(/^\//, "")}`}
            className="inline-block bg-primary text-primary-foreground font-semibold px-6 py-2 rounded-full hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 text-sm"
          >
            {banner.cta_text}
          </Link>
        )}
      </div>

      {banners.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center backdrop-blur-sm transition"
            aria-label="Previous"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center backdrop-blur-sm transition"
            aria-label="Next"
          >
            <ChevronRight size={18} />
          </button>

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex gap-1.5">
            {banners.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`rounded-full transition-all duration-300 ${i === current ? "w-5 h-2 bg-white" : "w-2 h-2 bg-white/50 hover:bg-white/80"}`}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
