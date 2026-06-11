import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { ShoppingCart, Search, User, Menu, X, Heart, LogOut, Package } from "lucide-react";
import CartDrawer from "./CartDrawer";
import SearchSuggestions from "./SearchSuggestions";
import { LoginModal } from "@/components/auth/LoginModal";
import MobileBottomNav from "./MobileBottomNav";
import AnnouncementBar from "./AnnouncementBar";
import { useCart } from "@/lib/cart/context";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { useSettings } from "@/lib/settings/context";
import { apiUrl } from "@/lib/api";

// ─── Navigation Pages Hook ───────────────────────────────────────────────────

interface NavPage {
  id: string;
  slug: string;
  title: string;
  show_in_header: boolean;
  show_in_footer: boolean;
  sort_order: number;
}

function useHeaderPages(locale: string): NavPage[] {
  const [pages, setPages] = useState<NavPage[]>([]);

  useEffect(() => {
    fetch(apiUrl(`/pages?locale=${locale}`))
      .then((r) => (r.ok ? r.json() : []))
      .then((data: NavPage[]) => {
        const headerPages = data
          .filter((p) => p.show_in_header)
          .sort((a, b) => a.sort_order - b.sort_order);
        setPages(headerPages);
      })
      .catch(() => setPages([]));
  }, [locale]);

  return pages;
}

// ─── Header Component ────────────────────────────────────────────────────────

export default function StorefrontHeader({ locale }: { locale: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const { itemCount } = useCart();
  const { t } = useI18n();
  const { settings, getStoreName } = useSettings();
  const headerPages = useHeaderPages(locale);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: any) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_: any, session: any) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setUserMenuOpen(false);
  };

  const storeName = getStoreName(locale);

  return (
    <>
      <AnnouncementBar />

      <header className="sticky top-0 z-40 bg-[hsl(var(--header-bg,var(--secondary)))] border-b border-[hsl(var(--border))]">
        <div className="container mx-auto px-3 sm:px-4">

          {/* Main row */}
          <div className="flex items-center justify-between h-14 sm:h-16 gap-2">

            {/* Logo — use logo_url from settings or display store name */}
            <Link href={`/${locale}`} className="shrink-0 flex items-center py-1">
              {settings.logo_url ? (
                <img
                  src={settings.logo_url}
                  alt={storeName}
                  className="h-10 sm:h-12 w-auto object-contain"
                />
              ) : (
                <span className="text-lg sm:text-xl font-bold text-[hsl(var(--primary))]">
                  {storeName}
                </span>
              )}
            </Link>

            {/* Desktop search bar */}
            <div className="hidden md:flex flex-1 max-w-xl mx-4">
              <SearchBar locale={locale} onClose={() => {}} inline />
            </div>

            {/* Desktop nav links */}
            <nav className="hidden lg:flex items-center gap-5 text-sm shrink-0">
              <Link href={`/${locale}/products`} className="text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] transition font-medium">{t("Header.products")}</Link>
              <Link href={`/${locale}/categories`} className="text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] transition font-medium">{t("Header.categories")}</Link>
              {headerPages.map((page) => (
                <Link
                  key={page.id}
                  href={`/${locale}/page/${page.slug}`}
                  className="text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] transition font-medium"
                >
                  {page.title}
                </Link>
              ))}
            </nav>

            {/* Action icons */}
            <div className="flex items-center gap-0.5 shrink-0">

              {/* Mobile search toggle */}
              <button onClick={() => setSearchOpen(!searchOpen)}
                className="md:hidden p-2 rounded-lg text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] transition" aria-label="Search">
                <Search size={20} />
              </button>

              {user && (
                <Link href={`/${locale}/wishlist`}
                  className="hidden sm:flex p-2 rounded-lg text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] transition" aria-label="Wishlist">
                  <Heart size={20} />
                </Link>
              )}

              {/* Cart */}
              <button onClick={() => setCartOpen(true)}
                className="hidden md:flex relative p-2 rounded-lg text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] transition" aria-label="Cart">
                <ShoppingCart size={20} />
                {itemCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground,0_0%_100%))] text-[10px] font-bold rounded-full flex items-center justify-center">
                    {itemCount > 9 ? "9+" : itemCount}
                  </span>
                )}
              </button>

              {/* Account */}
              <div className="relative hidden md:block">
                <button
                  onClick={() => user ? setUserMenuOpen((v) => !v) : setLoginOpen(true)}
                  className="p-2 rounded-lg text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] transition" aria-label="Account">
                  <User size={20} className={user ? "text-[hsl(var(--primary))]" : ""} />
                </button>
                {userMenuOpen && user && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 w-48 bg-background border border-border rounded-xl shadow-lg overflow-hidden z-50">
                      <div className="px-3 py-2 border-b border-border">
                        <p className="text-xs text-muted-foreground truncate">{user.phone ?? user.email ?? "Account"}</p>
                      </div>
                      <Link href={`/${locale}/profile`}
                        className="flex items-center gap-2 px-3 py-2.5 hover:bg-accent text-sm transition"
                        onClick={() => setUserMenuOpen(false)}>
                        <Package size={15} /> {t("Header.myOrders")}
                      </Link>
                      <Link href={`/${locale}/wishlist`}
                        className="flex items-center gap-2 px-3 py-2.5 hover:bg-accent text-sm transition"
                        onClick={() => setUserMenuOpen(false)}>
                        <Heart size={15} /> {t("Header.wishlist")}
                      </Link>
                      <button onClick={handleSignOut}
                        className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-accent text-sm text-destructive transition border-t border-border">
                        <LogOut size={15} /> {t("Header.signOut")}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <LocaleSwitcher currentLocale={locale} />

              {/* Hamburger — tablet */}
              <button className="hidden sm:flex md:hidden p-2 rounded-lg text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] transition"
                onClick={() => setMobileOpen(!mobileOpen)}>
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>

          {/* Mobile search dropdown */}
          {searchOpen && (
            <div className="md:hidden pb-3">
              <SearchBar locale={locale} onClose={() => setSearchOpen(false)} autoFocus dark />
            </div>
          )}

          {/* Tablet nav dropdown */}
          {mobileOpen && (
            <div className="sm:flex md:hidden flex-col border-t border-[hsl(var(--border))] py-3 space-y-1">
              <Link href={`/${locale}/products`}
                className="block px-2 py-2 rounded text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] text-sm"
                onClick={() => setMobileOpen(false)}>{t("Header.products")}</Link>
              <Link href={`/${locale}/categories`}
                className="block px-2 py-2 rounded text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] text-sm"
                onClick={() => setMobileOpen(false)}>{t("Header.categories")}</Link>
              {headerPages.map((page) => (
                <Link
                  key={page.id}
                  href={`/${locale}/page/${page.slug}`}
                  className="block px-2 py-2 rounded text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] text-sm"
                  onClick={() => setMobileOpen(false)}
                >
                  {page.title}
                </Link>
              ))}
              {user ? (
                <>
                  <Link href={`/${locale}/profile`}
                    className="block px-2 py-2 rounded text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] text-sm"
                    onClick={() => setMobileOpen(false)}>{t("Header.myOrders")}</Link>
                  <Link href={`/${locale}/wishlist`}
                    className="block px-2 py-2 rounded text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] text-sm"
                    onClick={() => setMobileOpen(false)}>{t("Header.wishlist")}</Link>
                  <button onClick={() => { handleSignOut(); setMobileOpen(false); }}
                    className="block w-full text-left px-2 py-2 rounded text-sm text-destructive hover:bg-[hsl(var(--muted)/0.2)]">
                    {t("Header.signOut")}
                  </button>
                </>
              ) : (
                <button onClick={() => { setLoginOpen(true); setMobileOpen(false); }}
                  className="block w-full text-left px-2 py-2 rounded text-[hsl(var(--foreground)/0.7)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)] text-sm">
                  {t("Header.signIn")}
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Mobile bottom navigation */}
      <MobileBottomNav
        locale={locale}
        onSearchClick={() => setSearchOpen(true)}
        onCartClick={() => setCartOpen(true)}
        onAccountClick={() => user ? setUserMenuOpen(true) : setLoginOpen(true)}
      />

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} locale={locale} />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}

function LocaleSwitcher({ currentLocale }: { currentLocale: string }) {
  const [location] = useLocation();
  const locales = ["az", "ru", "en"];

  const switchLocale = (newLocale: string) => {
    const parts = location.split("/").filter(Boolean);
    if (locales.includes(parts[0])) parts[0] = newLocale;
    else parts.unshift(newLocale);
    window.location.href = `/${parts.join("/")}`;
  };

  return (
    <div className="flex items-center gap-0.5 border border-[hsl(var(--border))] rounded-lg overflow-hidden">
      {locales.map((l) => (
        <button key={l} onClick={() => switchLocale(l)}
          className={`px-1.5 sm:px-2 py-1 text-[10px] sm:text-xs font-medium transition ${currentLocale === l ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground,0_0%_100%))]" : "text-[hsl(var(--foreground)/0.5)] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted)/0.2)]"}`}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function SearchBar({ locale, onClose, inline, autoFocus, dark }: {
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
