"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart, Search, Heart, User, Menu, X } from "lucide-react";
import LocaleSwitcher from "./locale-switcher";
import { LazyLoginModal } from "@/components/auth/lazy-login-modal";
import { createClient } from "@/lib/supabase/client";

export default function StorefrontHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const pathname = usePathname();

  const locale = pathname.split("/")[1] || "az";
  const storeName = process.env.NEXT_PUBLIC_STORE_NAME ?? "Store";

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href={`/${locale}`} className="font-bold text-xl text-primary">
            {storeName}
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <Link href={`/${locale}/products`} className="hover:text-primary transition">
              Products
            </Link>
            <Link href={`/${locale}/categories`} className="hover:text-primary transition">
              Categories
            </Link>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="p-2 rounded-lg hover:bg-accent transition"
              aria-label="Search"
            >
              <Search size={20} />
            </button>
            <Link href={`/${locale}/wishlist`} className="p-2 rounded-lg hover:bg-accent transition">
              <Heart size={20} />
            </Link>
            <Link href={`/${locale}/cart`} className="p-2 rounded-lg hover:bg-accent transition relative">
              <ShoppingCart size={20} />
            </Link>
            <button
              onClick={() => setLoginOpen(true)}
              className="p-2 rounded-lg hover:bg-accent transition"
              aria-label="Account"
            >
              <User size={20} />
            </button>
            <LocaleSwitcher currentLocale={locale} />
            <button
              className="md:hidden p-2 rounded-lg hover:bg-accent transition"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Search bar */}
        {searchOpen && (
          <div className="pb-3">
            <SearchBar locale={locale} onClose={() => setSearchOpen(false)} />
          </div>
        )}

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-border py-3 space-y-1">
            <Link href={`/${locale}/products`} className="block px-2 py-2 rounded hover:bg-accent text-sm">
              Products
            </Link>
            <Link href={`/${locale}/categories`} className="block px-2 py-2 rounded hover:bg-accent text-sm">
              Categories
            </Link>
          </div>
        )}
      </div>

      <LazyLoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </header>
  );
}

function SearchBar({
  locale,
  onClose,
}: {
  locale: string;
  onClose: () => void;
}) {
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
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products..."
        className="flex-1 px-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="submit"
        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition"
      >
        Search
      </button>
      <button
        type="button"
        onClick={onClose}
        className="px-3 py-2 rounded-lg hover:bg-accent text-sm transition"
      >
        Cancel
      </button>
    </form>
  );
}
