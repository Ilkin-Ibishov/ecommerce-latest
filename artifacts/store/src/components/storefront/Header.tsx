import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ShoppingCart, Search, User, Menu, X, Heart, LogOut, Package } from "lucide-react";
import CartDrawer from "./CartDrawer";
import { LoginModal } from "@/components/auth/LoginModal";
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
  const storeName = import.meta.env.VITE_STORE_NAME ?? "Store";
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
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <Link href={`/${locale}`} className="font-bold text-xl text-primary">{storeName}</Link>

            <nav className="hidden md:flex items-center gap-6 text-sm">
              <Link href={`/${locale}/products`} className="hover:text-primary transition">Products</Link>
              <Link href={`/${locale}/categories`} className="hover:text-primary transition">Categories</Link>
            </nav>

            <div className="flex items-center gap-1">
              <button onClick={() => setSearchOpen(!searchOpen)}
                className="p-2 rounded-lg hover:bg-accent transition" aria-label="Search">
                <Search size={20} />
              </button>

              {user && (
                <Link href={`/${locale}/wishlist`}
                  className="p-2 rounded-lg hover:bg-accent transition" aria-label="Wishlist">
                  <Heart size={20} />
                </Link>
              )}

              <button onClick={() => setCartOpen(true)}
                className="relative p-2 rounded-lg hover:bg-accent transition" aria-label="Cart">
                <ShoppingCart size={20} />
                {itemCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                    {itemCount > 9 ? "9+" : itemCount}
                  </span>
                )}
              </button>

              <div className="relative">
                <button
                  onClick={() => user ? setUserMenuOpen((v) => !v) : setLoginOpen(true)}
                  className="p-2 rounded-lg hover:bg-accent transition" aria-label="Account">
                  <User size={20} className={user ? "text-primary" : ""} />
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
                        <Package size={15} /> My Orders
                      </Link>
                      <Link href={`/${locale}/wishlist`}
                        className="flex items-center gap-2 px-3 py-2.5 hover:bg-accent text-sm transition"
                        onClick={() => setUserMenuOpen(false)}>
                        <Heart size={15} /> Wishlist
                      </Link>
                      <button onClick={handleSignOut}
                        className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-accent text-sm text-destructive transition border-t border-border">
                        <LogOut size={15} /> Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>

              <LocaleSwitcher currentLocale={locale} />

              <button className="md:hidden p-2 rounded-lg hover:bg-accent transition"
                onClick={() => setMobileOpen(!mobileOpen)}>
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>

          {searchOpen && (
            <div className="pb-3">
              <SearchBar locale={locale} onClose={() => setSearchOpen(false)} />
            </div>
          )}

          {mobileOpen && (
            <div className="md:hidden border-t border-border py-3 space-y-1">
              <Link href={`/${locale}/products`}
                className="block px-2 py-2 rounded hover:bg-accent text-sm"
                onClick={() => setMobileOpen(false)}>Products</Link>
              <Link href={`/${locale}/categories`}
                className="block px-2 py-2 rounded hover:bg-accent text-sm"
                onClick={() => setMobileOpen(false)}>Categories</Link>
              {user ? (
                <>
                  <Link href={`/${locale}/profile`}
                    className="block px-2 py-2 rounded hover:bg-accent text-sm"
                    onClick={() => setMobileOpen(false)}>My Orders</Link>
                  <Link href={`/${locale}/wishlist`}
                    className="block px-2 py-2 rounded hover:bg-accent text-sm"
                    onClick={() => setMobileOpen(false)}>Wishlist</Link>
                  <button onClick={() => { handleSignOut(); setMobileOpen(false); }}
                    className="block w-full text-left px-2 py-2 rounded hover:bg-accent text-sm text-destructive">
                    Sign Out
                  </button>
                </>
              ) : (
                <button onClick={() => { setLoginOpen(true); setMobileOpen(false); }}
                  className="block w-full text-left px-2 py-2 rounded hover:bg-accent text-sm">
                  Sign In
                </button>
              )}
            </div>
          )}
        </div>
      </header>

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
    <div className="flex items-center gap-0.5 border border-border rounded-lg overflow-hidden">
      {locales.map((l) => (
        <button key={l} onClick={() => switchLocale(l)}
          className={`px-2 py-1 text-xs font-medium transition ${currentLocale === l ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"}`}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function SearchBar({ locale, onClose }: { locale: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      window.location.href = `/${locale}/search?q=${encodeURIComponent(query.trim())}`;
      onClose();
    }
  };
  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products…"
        className="flex-1 px-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
      <button type="submit"
        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition">
        Search
      </button>
      <button type="button" onClick={onClose}
        className="px-3 py-2 rounded-lg hover:bg-accent text-sm transition">Cancel</button>
    </form>
  );
}
