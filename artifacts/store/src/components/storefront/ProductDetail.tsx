import { useState, useEffect, useRef, useCallback } from "react";
import { Minus, Plus, MessageSquare, Send, Star, ZoomIn, Ruler } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCart } from "@/lib/cart/context";
import { useI18n } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { getTranslatedField } from "@/lib/utils";
import { toastCartAdd } from "@/hooks/use-toast";
import { WishlistButton } from "./WishlistButton";
import { LoginModal } from "@/components/auth/LoginModal";
import RecentlyViewed from "./RecentlyViewed";
import ProductCard from "./ProductCard";
import { StarInput } from "./product-detail/StarInput";
import { StarDisplay } from "./product-detail/StarDisplay";
import { ImageLightbox } from "./product-detail/ImageLightbox";
import { AnimatedCartButton } from "./AnimatedCartButton";
import { StickyAddToCartBar } from "./StickyAddToCartBar";
import { SizeGuideOverlay } from "./SizeGuideOverlay";

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

export default function ProductDetail({ product, images, translation, comments: initialComments, locale, specs, related }: Props) {
  const [mainImage, setMainImage] = useState(images[0] ?? null);
  const [mainImageIdx, setMainImageIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const primaryCtaRef = useRef<HTMLDivElement>(null);

  // Reset main image when images prop changes (e.g. navigating between products)
  useEffect(() => {
    setMainImage(images[0] ?? null);
    setMainImageIdx(0);
  }, [product.id]);
  const [showLogin, setShowLogin] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [comments, setComments] = useState(initialComments);
  const [commentText, setCommentText] = useState("");
  const [commentRating, setCommentRating] = useState(0);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentStatus, setCommentStatus] = useState<"idle" | "success" | "error">("idle");
  const [user, setUser] = useState<any>(null);
  const { addItem, updateQty, getItemQty } = useCart();
  const { t } = useI18n();

  // Size Guide state
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const sizeGuideTriggerRef = useRef<HTMLButtonElement>(null);

  // Determine product's category_id for size guide lookup
  const categoryId = (product.product_categories as any[])?.[0]?.category_id as string | undefined;

  // Pre-fetch size guide data to conditionally render the link (Requirement 7.7)
  const { data: sizeGuide } = useQuery({
    queryKey: ["size-guide-check", categoryId, locale],
    queryFn: () => fetch(apiUrl(`/size-guides/${categoryId}?locale=${locale}`)).then(r => r.ok ? r.json() : null).catch(() => null),
    enabled: !!categoryId,
  });

  const cartQty = getItemQty(product.id);
  const isInCart = cartQty > 0;

  // Initialize qty from cart if already in cart, reset when product changes
  useEffect(() => {
    setQty(cartQty > 0 ? cartQty : 1);
  }, [product.id, cartQty]);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: any) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_: any, session: any) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const handleSetMainImage = (img: any, idx: number) => {
    setMainImage(img);
    setMainImageIdx(idx);
  };

  const handleAddToCart = useCallback(() => {
    if (isInCart) {
      updateQty(product.id, qty);
    } else {
      addItem({
        product_id: product.id,
        slug: product.slug,
        title: translation.title,
        price: product.price,
        image: images[0]?.url ?? null,
      }, qty);
    }
    toastCartAdd(t, translation.title);
  }, [isInCart, updateQty, addItem, product, translation, images, qty, t]);

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
    getTranslatedField(p.product_translations, locale, "title", "Məhsul");

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-1 flex-wrap">
        <a href={`/${locale}`} className="hover:text-foreground">{t("ProductDetail.home")}</a>
        <span>/</span>
        <a href={`/${locale}/products`} className="hover:text-foreground">{t("ProductDetail.productsLink")}</a>
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
                <span className="text-xs bg-orange-100 text-orange-600 font-semibold px-2 py-1 rounded-full">🔥 {t("ProductDetail.dealOfDay")}</span>
              )}
            </div>

            {/* Installment */}
            <p className="text-sm text-muted-foreground mt-1">
              {t("ProductDetail.installment").replace("{amount}", monthlyPrice).replace("{months}", String(INSTALLMENT_MONTHS))}
            </p>
          </div>

          {/* Stock */}
          <div>
            {inStock ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {t("ProductDetail.inStock")}
                {product.stock < 10 && <span className="text-orange-500">— {t("ProductDetail.onlyLeft").replace("{count}", String(product.stock))}</span>}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                {t("ProductDetail.outOfStock")}
              </span>
            )}
          </div>

          {/* Quantity */}
          {inStock && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{t("ProductDetail.quantity")}</span>
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

              {/* Size Guide link — only renders if size guide data exists (Req 7.1, 7.7) */}
              {sizeGuide && (
                <button
                  ref={sizeGuideTriggerRef}
                  type="button"
                  onClick={() => setSizeGuideOpen(true)}
                  className="ml-auto inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 underline underline-offset-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                >
                  <Ruler size={14} />
                  {t("SizeGuide.header")}
                </button>
              )}
            </div>
          )}

          {/* Cart + Wishlist */}
          <div className="flex gap-3">
            <div ref={primaryCtaRef} className="flex-1">
              <AnimatedCartButton
                onAdd={handleAddToCart}
                disabled={!inStock}
                label={
                  !inStock
                    ? t("ProductDetail.outOfStock")
                    : isInCart
                    ? t("ProductDetail.updateCart")
                    : t("ProductDetail.addToCart")
                }
                size="lg"
                className="w-full py-3.5 rounded-full"
              />
            </div>
            <WishlistButton
              productId={product.id}
              productName={translation.title}
              onAuthRequired={() => setShowLogin(true)}
              className="w-12 h-12"
            />
          </div>

          {/* Payment info */}
          <div className="bg-secondary rounded-xl p-4 text-sm space-y-1.5">
            <p className="font-medium">{t("ProductDetail.payOnDelivery")}</p>
            <p className="text-muted-foreground">{t("ProductDetail.payOnDeliveryDesc")}</p>
            <p className="font-medium mt-1">{t("ProductDetail.freeDeliveryOver")}</p>
          </div>

          {/* Description */}
          {translation.description && (
            <div>
              <h3 className="font-semibold mb-2">{t("ProductDetail.aboutProduct")}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">{translation.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* Specs table */}
      {specs && specs.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl font-bold mb-4">{t("ProductDetail.specs")}</h2>
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
          <h2 className="text-xl font-bold mb-5">{t("ProductDetail.relatedProducts")}</h2>
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
          {t("ProductDetail.reviews")} ({comments.length})
        </h2>

        <form onSubmit={handleSubmitComment} className="mb-8 bg-secondary/40 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium">{t("ProductDetail.writeReview")}</p>
          {!user && (
            <p className="text-xs text-muted-foreground">
              <button type="button" onClick={() => setShowLogin(true)} className="text-primary underline">{t("ProductDetail.signInToReview")}</button> {t("ProductDetail.signInToReviewSuffix")}
            </p>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("ProductDetail.ratingLabel")}</p>
            <StarInput value={commentRating} onChange={setCommentRating} />
          </div>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={t("ProductDetail.reviewPlaceholder")}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          {commentStatus === "success" && (
            <p className="text-xs text-green-600 font-medium">{t("ProductDetail.reviewSuccess")}</p>
          )}
          {commentStatus === "error" && (
            <p className="text-xs text-destructive">{t("ProductDetail.reviewError")}</p>
          )}
          <button
            type="submit"
            disabled={commentLoading || !commentText.trim()}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
          >
            <Send size={14} />
            {commentLoading ? t("ProductDetail.submittingReview") : t("ProductDetail.submitReview")}
          </button>
        </form>

        {comments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("ProductDetail.noReviews")}</p>
        ) : (
          <div className="space-y-4">
            {comments.map((c: any) => (
              <div key={c.id} className="bg-secondary/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{c.users?.full_name ?? t("ProductDetail.anonymous")}</span>
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

      {/* Size Guide Overlay */}
      {categoryId && sizeGuide && (
        <SizeGuideOverlay
          categoryId={categoryId}
          open={sizeGuideOpen}
          onClose={() => setSizeGuideOpen(false)}
          triggerRef={sizeGuideTriggerRef}
        />
      )}

      <StickyAddToCartBar
        product={{
          product_id: product.id,
          slug: product.slug,
          title: translation.title,
          price: product.price,
          image: images[0]?.url ?? null,
          stock: product.stock,
        }}
        primaryCtaRef={primaryCtaRef}
      />
    </div>
  );
}
