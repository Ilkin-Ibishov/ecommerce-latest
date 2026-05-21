import { Link } from "wouter";

interface Props {
  slug: string;
  title: string;
  price: number;
  image: string | null;
  isOnSale?: boolean;
  isDealOfDay?: boolean;
  stock?: number;
  locale: string;
}

export default function ProductCard({
  slug, title, price, image, isOnSale, isDealOfDay, stock, locale,
}: Props) {
  const outOfStock = typeof stock === "number" && stock === 0;
  const lowStock   = typeof stock === "number" && stock > 0 && stock < 5;

  return (
    <Link
      href={`/${locale}/products/${slug}`}
      className="product-card group block rounded-xl border border-border bg-card overflow-hidden"
    >
      <div className="relative aspect-square bg-muted overflow-hidden">
        {image ? (
          <img
            src={image}
            alt={title}
            className="product-card-img object-cover w-full h-full"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            No image
          </div>
        )}

        {isOnSale && !outOfStock && (
          <span className="absolute top-2 left-2 bg-red-500 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-sm tracking-wide">
            SALE
          </span>
        )}
        {isDealOfDay && !isOnSale && !outOfStock && (
          <span className="absolute top-2 left-2 bg-orange-500 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-sm">
            🔥
          </span>
        )}

        {outOfStock && (
          <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center">
            <span className="text-xs font-medium text-muted-foreground bg-background/90 px-3 py-1.5 rounded-full">
              Out of stock
            </span>
          </div>
        )}
      </div>

      <div className="p-3">
        <h3 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors duration-200">
          {title}
        </h3>
        <p className="font-bold text-primary mt-1">{Number(price).toFixed(2)} AZN</p>
        {lowStock && (
          <p className="text-xs text-orange-500 mt-0.5">Only {stock} left</p>
        )}
      </div>
    </Link>
  );
}
