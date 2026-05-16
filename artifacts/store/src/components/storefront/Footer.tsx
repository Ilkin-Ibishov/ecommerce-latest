import { Link } from "wouter";

export default function StorefrontFooter({ locale }: { locale: string }) {
  const storeName = import.meta.env.VITE_STORE_NAME ?? "Store";
  return (
    <footer className="border-t border-border bg-background mt-16">
      <div className="container mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <span className="font-bold text-lg text-primary">{storeName}</span>
            <p className="text-sm text-muted-foreground mt-2">Quality products delivered across Azerbaijan.</p>
          </div>
          <div>
            <h4 className="font-semibold mb-3 text-sm">Shop</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href={`/${locale}/products`} className="hover:text-primary transition">All Products</Link></li>
              <li><Link href={`/${locale}/categories`} className="hover:text-primary transition">Categories</Link></li>
              <li><Link href={`/${locale}/products?sale=true`} className="hover:text-primary transition">On Sale</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-3 text-sm">Info</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href={`/${locale}/policies/delivery`} className="hover:text-primary transition">Delivery Info</Link></li>
              <li><Link href={`/${locale}/policies/returns`} className="hover:text-primary transition">Returns</Link></li>
              <li><Link href={`/${locale}/policies/terms`} className="hover:text-primary transition">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border mt-8 pt-6 text-xs text-muted-foreground text-center">
          © {new Date().getFullYear()} {storeName}. Cash on delivery · Azerbaijan only.
        </div>
      </div>
    </footer>
  );
}
