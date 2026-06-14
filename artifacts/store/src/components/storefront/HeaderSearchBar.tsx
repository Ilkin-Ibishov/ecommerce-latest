import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import SearchSuggestions from "./SearchSuggestions";
import { useI18n } from "@/lib/i18n/context";
import { apiUrl } from "@/lib/api";

export function SearchBar({ locale, onClose, inline, autoFocus, dark }: {
  locale: string;
  onClose: () => void;
  inline?: boolean;
  autoFocus?: boolean;
  dark?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{ products: any[]; categories: any[] }>({ products: [], categories: [] });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = (q: string) => {
    if (q.length < 2) {
      setSuggestions({ products: [], categories: [] });
      setShowSuggestions(false);
      return;
    }
    setLoading(true);
    fetch(apiUrl(`/search/suggest?q=${encodeURIComponent(q)}&locale=${locale}`))
      .then((r) => r.json())
      .then((data) => {
        setSuggestions({ products: data.products ?? [], categories: data.categories ?? [] });
        setShowSuggestions(true);
        setActiveIndex(-1);
      })
      .catch(() => {
        setSuggestions({ products: [], categories: [] });
      })
      .finally(() => setLoading(false));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val.trim()), 250);
  };

  const totalItems = suggestions.products.length + suggestions.categories.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i < totalItems - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : totalItems - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      // Navigate to the active suggestion
      if (activeIndex < suggestions.products.length) {
        const p = suggestions.products[activeIndex];
        window.location.href = `/${locale}/products/${p.slug}`;
      } else {
        const cat = suggestions.categories[activeIndex - suggestions.products.length];
        window.location.href = `/${locale}/categories/${cat.slug}`;
      }
      closeSuggestions();
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const closeSuggestions = () => {
    setShowSuggestions(false);
    setActiveIndex(-1);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      window.location.href = `/${locale}/search?q=${encodeURIComponent(query.trim())}`;
      closeSuggestions();
      onClose();
    }
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  if (inline) {
    return (
      <div ref={containerRef} className="relative w-full">
        <form onSubmit={handleSubmit} className="flex w-full gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted))] pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (query.trim().length >= 2) setShowSuggestions(true); }}
              placeholder={t("Header.searchPlaceholder")}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.1)] text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted))] text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:border-[hsl(var(--primary))] transition"
              autoComplete="off"
            />
          </div>
          <button type="submit"
            className="px-4 py-2 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground,0_0%_100%))] text-sm font-semibold hover:bg-[hsl(var(--primary)/0.9)] transition shrink-0">
            {t("Header.search")}
          </button>
        </form>
        <SearchSuggestions
          products={suggestions.products}
          categories={suggestions.categories}
          query={query}
          locale={locale}
          visible={showSuggestions}
          activeIndex={activeIndex}
          onClose={closeSuggestions}
          onSelect={closeSuggestions}
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          autoFocus={autoFocus}
          type="search"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.trim().length >= 2) setShowSuggestions(true); }}
          placeholder={t("Header.searchPlaceholder")}
          className={`flex-1 px-4 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 transition ${dark ? "border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.1)] text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted))] focus:ring-[hsl(var(--primary))]" : "border-border bg-background focus:ring-ring"}`}
          autoComplete="off"
        />
        <button type="submit"
          className="px-4 py-2 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground,0_0%_100%))] text-sm font-semibold hover:bg-[hsl(var(--primary)/0.9)] transition">
          {t("Header.search")}
        </button>
        <button type="button" onClick={onClose}
          className={`px-3 py-2 rounded-lg text-sm transition ${dark ? "text-[hsl(var(--muted))] hover:bg-[hsl(var(--muted)/0.2)]" : "hover:bg-accent"}`}>{t("Header.cancel")}</button>
      </form>
      <SearchSuggestions
        products={suggestions.products}
        categories={suggestions.categories}
        query={query}
        locale={locale}
        visible={showSuggestions}
        activeIndex={activeIndex}
        onClose={closeSuggestions}
        onSelect={closeSuggestions}
      />
    </div>
  );
}
