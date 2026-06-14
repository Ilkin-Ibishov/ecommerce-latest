import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ShoppingCart, Search, User, Menu, X, Heart, LogOut, Package } from "lucide-react";
import CartDrawer from "./CartDrawer";
import { LoginModal } from "@/components/auth/LoginModal";
import MobileBottomNav from "./MobileBottomNav";
import AnnouncementBar from "./AnnouncementBar";
import { SearchBar } from "./HeaderSearchBar";
import { LocaleSwitcher } from "./LocaleSwitcher";
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
                onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? "Close menu" : "Open menu"}>
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
