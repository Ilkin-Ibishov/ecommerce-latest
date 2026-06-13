import { useState } from "react";
import { Link } from "wouter";
import { ShoppingCart, Check, Star } from "lucide-react";
import { useCart } from "@/lib/cart/context";
import { useI18n } from "@/lib/i18n/context";
import { getProxyUrl } from "@/lib/image-proxy";

interface Props {
  slug: string;
  title: string;
  price: number;
  originalPrice?: number | null;
  image: string | null;
  isOnSale?: boolean;
  isDealOfDay?: boolean;
  stock?: number;
  locale: string;
  rating?: number | null;
  ratingCount?: number;
  brand?: string | null;
  productId?: string;
}

const INSTALLMENT_MONTHS = 12;

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={11}
          className={s <= Math.round(rating) ? "fill-yellow-400 text-yellow-400" : "fill-muted text-muted"}
        />
      ))}
    </div>
  );
}

export default function ProductCard({
  slug, title, price, originalPrice, image, isOnSale, isDealOfDay,
  stock, locale, rating, ratingCount, brand, productId,
}: Props) {
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();
  const { t } = useI18n();
  const outOfStock = typeof stock === "number" && stock === 0;
  const lowStock   = typeof stock === "number" && stock > 0 && stock < 5;
  const monthlyPrice = (price / INSTALLMENT_MONTHS).toFixed(2);
  const discount = originalPrice && originalPrice > price
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : null;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!productId || outOfStock) return;
    addItem({ product_id: productId, slug, title, price, image }, 1);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  };

  return (
    <Link
      href={`/${locale}/products/${slug}`}
      className="product-card group block rounded-xl border border-border bg-card overflow-hidden relative"
    >
      <div className="relative aspect-square bg-muted overflow-hidden">
        {image ? (
          <img
            src={getProxyUrl(image, "thumbnail")}
            alt={title}
            className="product-card-img object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            onError={(e) => {
              if (e.currentTarget.src !== image) {
                e.currentTarget.src = image;
              }
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            No image
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {discount && !outOfStock && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
              -{discount}%
            </span>
          )}
          {isOnSale && !discount && !outOfStock && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
              {t("ProductCard.sale")}
            </span>
          )}
          {isDealOfDay && !isOnSale && !outOfStock && (
            <span className="bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
              🔥
            </span>
          )}
        </div>

        {/* Quick add button */}
        {productId && !outOfStock && (
          <button
            onClick={handleAddToCart}
            className={`absolute bottom-2 right-2 w-9 h-9 rounded-full flex items-center justify-center shadow-md transition-all duration-200
              opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0
              ${added ? "bg-green-500 text-white scale-110" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
            aria-label={t("ProductCard.addToCart")}
          >
            {added ? <Check size={14} strokeWidth={3} /> : <ShoppingCart size={14} />}
          </button>
        )}

        {outOfStock && (
          <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center">
            <span className="text-xs font-medium text-muted-foreground bg-background/90 px-3 py-1.5 rounded-full">
              {t("ProductCard.outOfStock")}
            </span>
          </div>
        )}
      </div>

      <div className="p-3 space-y-1">
        {brand && (
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{brand}</p>
        )}
        <h3 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors duration-200 leading-snug">
          {title}
        </h3>

        {/* Rating */}
        {rating != null && (
          <div className="flex items-center gap-1">
            <StarRow rating={rating} />
            {ratingCount != null && ratingCount > 0 && (
              <span className="text-[10px] text-muted-foreground">({ratingCount})</span>
            )}
          </div>
        )}

        {/* Price row */}
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <p className="font-bold text-primary text-[15px]">{Number(price).toFixed(2)} AZN</p>
          {originalPrice && originalPrice > price && (
            <p className="text-xs text-muted-foreground line-through">{Number(originalPrice).toFixed(2)} AZN</p>
          )}
        </div>

        {/* Installment */}
        <p className="text-[10px] text-muted-foreground">
          {t("ProductCard.installment").replace("{amount}", monthlyPrice).replace("{months}", String(INSTALLMENT_MONTHS))}
        </p>

        {lowStock && (
          <p className="text-[10px] text-orange-500">{t("ProductCard.onlyLeft").replace("{count}", String(stock))}</p>
        )}
      </div>
    </Link>
  );
}
