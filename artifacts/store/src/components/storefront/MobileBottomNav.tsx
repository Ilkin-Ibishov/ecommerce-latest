import { Link, useLocation } from "wouter";
import { Home, Grid3X3, Search, ShoppingCart, User } from "lucide-react";
import { useCart } from "@/lib/cart/context";

interface MobileBottomNavProps {
  locale: string;
  onSearchClick: () => void;
  onCartClick: () => void;
  onAccountClick: () => void;
}

export default function MobileBottomNav({
  locale,
  onSearchClick,
  onCartClick,
  onAccountClick,
}: MobileBottomNavProps) {
  const [location] = useLocation();
  const { itemCount } = useCart();

  const isActive = (path: string) => location === path || location.startsWith(path + "/");

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border safe-area-pb">
      <div className="flex items-stretch h-16">
        <Link
          href={`/${locale}`}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${isActive(`/${locale}`) && location === `/${locale}` ? "text-primary" : "text-muted-foreground"}`}
        >
          <Home size={22} />
          <span>Ana səhifə</span>
        </Link>

        <Link
          href={`/${locale}/products`}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${isActive(`/${locale}/products`) ? "text-primary" : "text-muted-foreground"}`}
        >
          <Grid3X3 size={22} />
          <span>Məhsullar</span>
        </Link>

        <button
          onClick={onSearchClick}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <Search size={22} />
          <span>Axtar</span>
        </button>

        <button
          onClick={onCartClick}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary relative"
        >
          <span className="relative">
            <ShoppingCart size={22} />
            {itemCount > 0 && (
              <span className="absolute -top-1.5 -right-2 w-4 h-4 bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
                {itemCount > 9 ? "9+" : itemCount}
              </span>
            )}
          </span>
          <span>Səbət</span>
        </button>

        <button
          onClick={onAccountClick}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <User size={22} />
          <span>Hesab</span>
        </button>
      </div>
    </nav>
  );
}
