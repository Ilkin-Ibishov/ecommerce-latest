import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Heart, Trash2, ShoppingCart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { useCart } from "@/lib/cart/context";
import { LoginModal } from "@/components/auth/LoginModal";
import { useI18n } from "@/lib/i18n/context";

export default function WishlistPage({ locale }: { locale: string }) {
  const [user, setUser] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const { addItem } = useCart();
  const supabase = createClient();
  const { t } = useI18n();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: any) => {
      setUser(data.user ?? null);
      if (!data.user) { setLoading(false); return; }
      loadWishlist(data.user);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_: any, session: any) => {
      setUser(session?.user ?? null);
      if (session?.user) loadWishlist(session.user);
      else { setItems([]); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const getAuthHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}` };
  };

  const loadWishlist = async (_u: any) => {
    setLoading(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(apiUrl("/wishlist"), { headers });
      if (res.ok) setItems(await res.json());
    } catch {}
    setLoading(false);
  };

  const removeItem = async (productId: string) => {
    const headers = await getAuthHeader();
    await fetch(apiUrl(`/wishlist/${productId}`), { method: "DELETE", headers });
    setItems((prev) => prev.filter((i) => i.product_id !== productId));
  };

  const addToCart = (item: any) => {
    const product = item.products;
    if (!product) return;
    const title = product.product_translations?.find((t: any) => t.lang_code === locale)?.title
      ?? product.product_translations?.[0]?.title ?? "Product";
    addItem({
      product_id: product.id,
      slug: product.slug,
      title,
      price: product.price,
      image: product.product_images?.[0]?.url ?? null,
    });
  };

  if (!user && !loading) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <Heart size={48} className="mx-auto text-muted-foreground/30 mb-4" />
        <h1 className="text-2xl font-bold mb-2">{t("Wishlist.title")}</h1>
        <p className="text-muted-foreground mb-6">{t("Wishlist.signInPrompt")}</p>
        <button onClick={() => setShowLogin(true)}
          className="bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold hover:bg-primary/90 transition">
          {t("Wishlist.signInButton")}
        </button>
        <LoginModal open={showLogin} onClose={() => setShowLogin(false)} onSuccess={() => {}} />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Heart size={22} className="text-primary" /> {t("Wishlist.title")}
        {items.length > 0 && <span className="text-base font-normal text-muted-foreground">({items.length} {t("Wishlist.items")})</span>}
      </h1>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">{t("Wishlist.loading")}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <Heart size={48} className="mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground mb-3">{t("Wishlist.emptyWishlist")}</p>
          <Link href={`/${locale}/products`} className="text-primary hover:underline text-sm">{t("Wishlist.browseProducts")}</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {items.map((item: any) => {
            const product = item.products;
            if (!product) return null;
            const title = product.product_translations?.find((t: any) => t.lang_code === locale)?.title
              ?? product.product_translations?.[0]?.title ?? "Product";
            const img = product.product_images?.[0]?.url ?? null;
            return (
              <div key={item.id} className="group rounded-xl border border-border overflow-hidden">
                <Link href={`/${locale}/products/${product.slug}`}>
                  <div className="aspect-square bg-muted overflow-hidden">
                    {img ? (
                      <img src={img} alt={title} className="object-cover w-full h-full group-hover:scale-105 transition duration-300" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
                    )}
                  </div>
                </Link>
                <div className="p-3 space-y-2">
                  <Link href={`/${locale}/products/${product.slug}`}>
                    <h3 className="font-medium text-sm line-clamp-2 hover:text-primary transition">{title}</h3>
                  </Link>
                  <p className="font-bold text-primary text-sm">{Number(product.price).toFixed(2)} AZN</p>
                  <div className="flex gap-1.5">
                    <button onClick={() => addToCart(item)}
                      className="flex-1 flex items-center justify-center gap-1 text-xs bg-primary text-primary-foreground py-1.5 rounded-lg hover:bg-primary/90 transition">
                      <ShoppingCart size={12} /> {t("Wishlist.add")}
                    </button>
                    <button onClick={() => removeItem(item.product_id)}
                      className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-destructive border border-border rounded-lg transition">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
