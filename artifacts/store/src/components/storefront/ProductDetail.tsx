import { useState, useEffect, useRef } from "react";
import { ShoppingCart, Minus, Plus, Check, MessageSquare, Send, Star, ZoomIn, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useCart } from "@/lib/cart/context";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { WishlistButton } from "./WishlistButton";
import { LoginModal } from "@/components/auth/LoginModal";
import RecentlyViewed from "./RecentlyViewed";
import ProductCard from "./ProductCard";

interface Props {
  product: any;
  images: any[];
  translation: { title: string; description: string | null };
  comments: any[];
  locale: string;
  specs?: any[];
  related?: any[];
}

const INSTALLMENT_MONTHS = 12;

function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1" onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          onMouseEnter={() => setHovered(s)}
          className="p-0.5 focus:outline-none"
          aria-label={`${s} ulduz`}
        >
          <Star
            size={22}
            className={s <= (hovered || value) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}
          />
        </button>
      ))}
    </div>
  );
}

function StarDisplay({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={16}
          className={s <= Math.round(rating) ? "fill-yellow-400 text-yellow-400" : "fill-muted text-muted"}
        />
      ))}
      <span className="text-sm font-semibold">{rating.toFixed(1)}</span>
      <span className="text-sm text-muted-foreground">({count} rəy)</span>
    </div>
  );
}

function ImageLightbox({ images, initial, onClose }: { images: any[]; initial: number; onClose: () => void }) {
  const [idx, setIdx] = useState(initial);
  const prev = () => setIdx((i) => (i - 1 + images.length) % images.length);
  const next = () => setIdx((i) => (i + 1) % images.length);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition"
      >
        <X size={20} />
      </button>
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition"
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}
      <img
        src={images[idx]?.url}
        alt=""
        className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
      {images.length > 1 && (
        <div className="absolute bottom-4 flex gap-2">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); setIdx(i); }}
              className={`w-2 h-2 rounded-full transition ${i === idx ? "bg-white" : "bg-white/40"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProductDetail({ product, images, translation, comments: initialComments, locale, specs, related }: Props) {
  const [mainImage, setMainImage] = useState(images[0] ?? null);
  const [mainImageIdx, setMainImageIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [comments, setComments] = useState(initialComments);
  const [commentText, setCommentText] = useState("");
  const [commentRating, setCommentRating] = useState(0);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentStatus, setCommentStatus] = useState<"idle" | "success" | "error">("idle");
  const [user, setUser] = useState<any>(null);
  const { addItem } = useCart();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const handleSetMainImage = (img: any, idx: number) => {
    setMainImage(img);
    setMainImageIdx(idx);
  };

  const handleAddToCart = () => {
    addItem({
      product_id: product.id,
      slug: product.slug,
      title: translation.title,
      price: product.price,
      image: images[0]?.url ?? null,
    }, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    if (!user) { setShowLogin(true); return; }
    setCommentLoading(true);
    setCommentStatus("idle");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl(`/products/${product.id}/comments`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ content: commentText.trim(), rating: commentRating || undefined }),
      });
      if (res.ok) {
        setCommentText("");
        setCommentRating(0);
        setCommentStatus("success");
      } else {
        setCommentStatus("error");
      }
    } catch {
      setCommentStatus("error");
    }
    setCommentLoading(false);
  };

  const inStock = product.stock > 0;
  const originalPrice = product.original_price;
  const discount = originalPrice && originalPrice > product.price
    ? Math.round(((originalPrice - product.price) / originalPrice) * 100)
    : null;
  const monthlyPrice = (product.price / INSTALLMENT_MONTHS).toFixed(2);

  const ratingsWithVal = comments.filter((c: any) => c.rating != null);
  const avgRating = ratingsWithVal.length > 0
    ? ratingsWithVal.reduce((s: number, c: any) => s + c.rating, 0) / ratingsWithVal.length
    : null;

  const getRelatedTitle = (p: any) =>
    p.product_translations?.find((t: any) => t.lang_code === locale)?.title
    ?? p.product_translations?.[0]?.title ?? "Məhsul";

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-1 flex-wrap">
        <a href={`/${locale}`} className="hover:text-foreground">Ana səhifə</a>
        <span>/</span>
        <a href={`/${locale}/products`} className="hover:text-foreground">Məhsullar</a>
        <span>/</span>
        <span className="text-foreground">{translation.title}</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-16">
        {/* Image gallery */}
        <div className="space-y-3">
          <div
            className="relative aspect-square rounded-2xl overflow-hidden bg-muted border border-border cursor-zoom-in group"
            onClick={() => images.length > 0 && setShowLightbox(true)}
          >
            {mainImage ? (
              <img
                src={mainImage.url}
                alt={mainImage.alt_text ?? translation.title}
                className="object-contain w-full h-full transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">No image</div>
            )}
            {product.is_on_sale && (
              <span className="absolute top-3 left-3 bg-red-500 text-white text-sm font-bold px-3 py-1 rounded-full">
                {discount ? `-${discount}%` : "SALE"}
              </span>
            )}
            <div className="absolute top-3 right-3 w-9 h-9 bg-black/30 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition">
              <ZoomIn size={16} />
            </div>
          </div>

          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {images.map((img: any, i: number) => (
                <button
                  key={img.id}
                  onClick={() => handleSetMainImage(img, i)}
                  className={`relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border-2 transition ${mainImage?.id === img.id ? "border-primary" : "border-border hover:border-primary/50"}`}
                >
                  <img src={img.url} alt={img.alt_text ?? ""} className="object-cover w-full h-full" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product info */}
        <div className="space-y-5">
          {product.brand && (
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{product.brand}</p>
          )}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold leading-tight">{translation.title}</h1>

            {avgRating != null && (
              <div className="mt-2">
                <StarDisplay rating={avgRating} count={ratingsWithVal.length} />
              </div>
            )}

            <div className="flex items-baseline gap-3 mt-3 flex-wrap">
              <span className="text-3xl font-bold text-primary">{Number(product.price).toFixed(2)} AZN</span>
              {originalPrice && originalPrice > product.price && (
                <span className="text-lg text-muted-foreground line-through">{Number(originalPrice).toFixed(2)} AZN</span>
              )}
              {product.is_deal_of_day && (
                <span className="text-xs bg-orange-100 text-orange-600 font-semibold px-2 py-1 rounded-full">🔥 Günün təklifi</span>
              )}
            </div>

            {/* Installment */}
            <p className="text-sm text-muted-foreground mt-1">
              Ayda cəmi <span className="font-semibold text-foreground">{monthlyPrice} AZN</span> — {INSTALLMENT_MONTHS} aya bölün
            </p>
          </div>

          {/* Stock */}
          <div>
            {inStock ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Stokda var
                {product.stock < 10 && <span className="text-orange-500">— yalnız {product.stock} ədəd</span>}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                Stokda yoxdur
              </span>
            )}
          </div>

          {/* Quantity */}
          {inStock && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Miqdar</span>
              <div className="flex items-center rounded-full border-2 border-border bg-background overflow-hidden shadow-sm">
                <button
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  className="w-10 h-10 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                >
                  <Minus size={14} />
                </button>
                <span className="w-11 text-center text-sm font-semibold select-none">{qty}</span>
                <button
                  onClick={() => setQty(Math.min(product.stock, qty + 1))}
                  className="w-10 h-10 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Cart + Wishlist */}
          <div className="flex gap-3">
            <button
              onClick={handleAddToCart}
              disabled={!inStock || added}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full font-semibold transition-all duration-300 text-sm shadow-md ${
                added
                  ? "bg-green-500 text-white shadow-green-200 scale-[0.98]"
                  : inStock
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/25 active:scale-95"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              {added ? (
                <><Check size={18} strokeWidth={3} />Səbətə əlavə edildi</>
              ) : (
                <><ShoppingCart size={18} />{inStock ? "Səbətə əlavə et" : "Stokda yoxdur"}</>
              )}
            </button>
            <WishlistButton
              productId={product.id}
              onAuthRequired={() => setShowLogin(true)}
              className="w-12 h-12"
            />
          </div>

          {/* Payment info */}
          <div className="bg-secondary rounded-xl p-4 text-sm space-y-1.5">
            <p className="font-medium">💰 Çatdırılmada ödəniş</p>
            <p className="text-muted-foreground">Sifarişiniz çatanda AZN ilə ödəyin. Kart lazım deyil.</p>
            <p className="font-medium mt-1">📦 Pulsuz çatdırılma 50 AZN-dən yuxarı sifarişlərə</p>
          </div>

          {/* Description */}
          {translation.description && (
            <div>
              <h3 className="font-semibold mb-2">Məhsul haqqında</h3>
              <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">{translation.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* Specs table */}
      {specs && specs.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl font-bold mb-4">Texniki xüsusiyyətlər</h2>
          <div className="rounded-xl border border-border overflow-hidden">
            {specs.map((spec: any, i: number) => (
              <div
                key={spec.id ?? i}
                className={`flex ${i % 2 === 0 ? "bg-muted/50" : "bg-background"}`}
              >
                <div className="w-2/5 px-4 py-3 text-sm font-medium text-muted-foreground border-r border-border">{spec.spec_key}</div>
                <div className="flex-1 px-4 py-3 text-sm">{spec.spec_value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related products */}
      {related && related.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl font-bold mb-5">Oxşar məhsullar</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {related.map((p: any) => (
              <ProductCard
                key={p.id}
                productId={p.id}
                slug={p.slug}
                title={getRelatedTitle(p)}
                price={p.price}
                originalPrice={p.original_price}
                image={p.product_images?.[0]?.url ?? null}
                isOnSale={p.is_on_sale}
                isDealOfDay={p.is_deal_of_day}
                stock={p.stock}
                brand={p.brand}
                locale={locale}
              />
            ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      <div className="border-t border-border pt-10">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          <MessageSquare size={20} />
          Rəylər ({comments.length})
        </h2>

        <form onSubmit={handleSubmitComment} className="mb-8 bg-secondary/40 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium">Rəy yazın</p>
          {!user && (
            <p className="text-xs text-muted-foreground">
              <button type="button" onClick={() => setShowLogin(true)} className="text-primary underline">Daxil olun</button> ki, rəy yaza biləsiniz.
            </p>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Qiymətləndirməz:</p>
            <StarInput value={commentRating} onChange={setCommentRating} />
          </div>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Bu məhsul haqqında təcrübənizi paylaşın…"
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          {commentStatus === "success" && (
            <p className="text-xs text-green-600 font-medium">✓ Rəyiniz göndərildi! Moderasiyadan sonra görünəcək.</p>
          )}
          {commentStatus === "error" && (
            <p className="text-xs text-destructive">Göndərilə bilmədi. Yenidən cəhd edin.</p>
          )}
          <button
            type="submit"
            disabled={commentLoading || !commentText.trim()}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
          >
            <Send size={14} />
            {commentLoading ? "Göndərilir…" : "Rəy göndər"}
          </button>
        </form>

        {comments.length === 0 ? (
          <p className="text-muted-foreground text-sm">Hələ rəy yoxdur. İlk siz olun!</p>
        ) : (
          <div className="space-y-4">
            {comments.map((c: any) => (
              <div key={c.id} className="bg-secondary/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{c.users?.full_name ?? "Anonim"}</span>
                    {c.rating != null && (
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            size={12}
                            className={s <= c.rating ? "fill-yellow-400 text-yellow-400" : "fill-muted text-muted"}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString("az-AZ")}</span>
                </div>
                <p className="text-sm text-muted-foreground">{c.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <RecentlyViewed locale={locale} excludeId={product.id} />

      {showLightbox && (
        <ImageLightbox images={images} initial={mainImageIdx} onClose={() => setShowLightbox(false)} />
      )}

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} onSuccess={() => {}} />
    </div>
  );
}
