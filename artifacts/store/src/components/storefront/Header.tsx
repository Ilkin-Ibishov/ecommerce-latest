import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ShoppingCart, Search, User, Menu, X, Heart, LogOut, Package } from "lucide-react";
import CartDrawer from "./CartDrawer";
import { LoginModal } from "@/components/auth/LoginModal";
import MobileBottomNav from "./MobileBottomNav";
import AnnouncementBar from "./AnnouncementBar";
import { useCart } from "@/lib/cart/context";
import { createClient } from "@/lib/supabase/client";

export default function StorefrontHeader({ locale }: { locale: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const { itemCount } = useCart();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setUserMenuOpen(false);
  };

  return (
    <>
      <AnnouncementBar />

      <header className="sticky top-0 z-40 bg-gray-950 border-b border-gray-800">
        <div className="container mx-auto px-3 sm:px-4">

          {/* Main row */}
          <div className="flex items-center justify-between h-14 sm:h-16 gap-2">

            {/* Logo — transparent PNG on dark header */}
            <Link href={`/${locale}`} className="shrink-0 flex items-center py-1">
              <img
                src="/logo.png"
                alt="İlk Electronics"
                className="h-10 sm:h-12 w-auto object-contain"
              />
            </Link>

            {/* Desktop search bar */}
            <div className="hidden md:flex flex-1 max-w-xl mx-4">
              <SearchBar locale={locale} onClose={() => {}} inline />
            </div>

            {/* Desktop nav links */}
            <nav className="hidden lg:flex items-center gap-5 text-sm shrink-0">
              <Link href={`/${locale}/products`} className="text-gray-300 hover:text-yellow-400 transition font-medium">Məhsullar</Link>
              <Link href={`/${locale}/categories`} className="text-gray-300 hover:text-yellow-400 transition font-medium">Kateqoriyalar</Link>
            </nav>

            {/* Action icons */}
            <div className="flex items-center gap-0.5 shrink-0">

              {/* Mobile search toggle */}
              <button onClick={() => setSearchOpen(!searchOpen)}
                className="md:hidden p-2 rounded-lg text-gray-300 hover:text-yellow-400 hover:bg-gray-800 transition" aria-label="Search">
                <Search size={20} />
              </button>

              {user && (
                <Link href={`/${locale}/wishlist`}
                  className="hidden sm:flex p-2 rounded-lg text-gray-300 hover:text-yellow-400 hover:bg-gray-800 transition" aria-label="Wishlist">
                  <Heart size={20} />
                </Link>
              )}

              {/* Cart */}
              <button onClick={() => setCartOpen(true)}
                className="hidden md:flex relative p-2 rounded-lg text-gray-300 hover:text-yellow-400 hover:bg-gray-800 transition" aria-label="Cart">
                <ShoppingCart size={20} />
                {itemCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                    {itemCount > 9 ? "9+" : itemCount}
                  </span>
                )}
              </button>

              {/* Account */}
              <div className="relative hidden md:block">
                <button
                  onClick={() => user ? setUserMenuOpen((v) => !v) : setLoginOpen(true)}
                  className="p-2 rounded-lg text-gray-300 hover:text-yellow-400 hover:bg-gray-800 transition" aria-label="Account">
                  <User size={20} className={user ? "text-yellow-400" : ""} />
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
                        <Package size={15} /> Sifarişlərim
                      </Link>
                      <Link href={`/${locale}/wishlist`}
                        className="flex items-center gap-2 px-3 py-2.5 hover:bg-accent text-sm transition"
                        onClick={() => setUserMenuOpen(false)}>
                        <Heart size={15} /> İstək siyahısı
                      </Link>
                      <button onClick={handleSignOut}
                        className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-accent text-sm text-destructive transition border-t border-border">
                        <LogOut size={15} /> Çıxış
                      </button>
                    </div>
                  </>
                )}
              </div>

              <LocaleSwitcher currentLocale={locale} />

              {/* Hamburger — tablet */}
              <button className="hidden sm:flex md:hidden p-2 rounded-lg text-gray-300 hover:text-yellow-400 hover:bg-gray-800 transition"
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
            <div className="sm:flex md:hidden flex-col border-t border-gray-800 py-3 space-y-1">
              <Link href={`/${locale}/products`}
                className="block px-2 py-2 rounded text-gray-300 hover:text-yellow-400 hover:bg-gray-800 text-sm"
                onClick={() => setMobileOpen(false)}>Məhsullar</Link>
              <Link href={`/${locale}/categories`}
                className="block px-2 py-2 rounded text-gray-300 hover:text-yellow-400 hover:bg-gray-800 text-sm"
                onClick={() => setMobileOpen(false)}>Kateqoriyalar</Link>
              {user ? (
                <>
                  <Link href={`/${locale}/profile`}
                    className="block px-2 py-2 rounded text-gray-300 hover:text-yellow-400 hover:bg-gray-800 text-sm"
                    onClick={() => setMobileOpen(false)}>Sifarişlərim</Link>
                  <Link href={`/${locale}/wishlist`}
                    className="block px-2 py-2 rounded text-gray-300 hover:text-yellow-400 hover:bg-gray-800 text-sm"
                    onClick={() => setMobileOpen(false)}>İstək siyahısı</Link>
                  <button onClick={() => { handleSignOut(); setMobileOpen(false); }}
                    className="block w-full text-left px-2 py-2 rounded text-sm text-red-400 hover:bg-gray-800">
                    Çıxış
                  </button>
                </>
              ) : (
                <button onClick={() => { setLoginOpen(true); setMobileOpen(false); }}
                  className="block w-full text-left px-2 py-2 rounded text-gray-300 hover:text-yellow-400 hover:bg-gray-800 text-sm">
                  Daxil ol
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
    <div className="flex items-center gap-0.5 border border-gray-700 rounded-lg overflow-hidden">
      {locales.map((l) => (
        <button key={l} onClick={() => switchLocale(l)}
          className={`px-1.5 sm:px-2 py-1 text-[10px] sm:text-xs font-medium transition ${currentLocale === l ? "bg-yellow-500 text-gray-900" : "text-gray-400 hover:text-yellow-400 hover:bg-gray-800"}`}>
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
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      window.location.href = `/${locale}/search?q=${encodeURIComponent(query.trim())}`;
      onClose();
    }
  };

  if (inline) {
    return (
      <form onSubmit={handleSubmit} className="flex w-full gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Məhsul axtar…"
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-700 bg-gray-800 text-gray-100 placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 transition"
          />
        </div>
        <button type="submit"
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition shrink-0">
          Axtar
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        autoFocus={autoFocus}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Məhsul axtar…"
        className={`flex-1 px-4 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 transition ${dark ? "border-gray-700 bg-gray-800 text-gray-100 placeholder-gray-500 focus:ring-yellow-500" : "border-border bg-background focus:ring-ring"}`}
      />
      <button type="submit"
        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition">
        Axtar
      </button>
      <button type="button" onClick={onClose}
        className={`px-3 py-2 rounded-lg text-sm transition ${dark ? "text-gray-400 hover:bg-gray-800" : "hover:bg-accent"}`}>İmtina</button>
    </form>
  );
}
