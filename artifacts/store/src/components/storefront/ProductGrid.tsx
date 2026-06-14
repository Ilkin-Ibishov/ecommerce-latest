import ProductCard from "@/components/storefront/ProductCard";
import { ProductSkeletonGrid } from "@/components/storefront/ProductSkeleton";

/** Shape consumed by the storefront product grid (maps onto ProductCard props). */
export interface ProductCardData {
  id: string;
  slug: string;
  title: string;
  price: number;
  original_price?: number | null;
  image?: string | null;
  is_on_sale?: boolean;
  is_deal_of_day?: boolean;
  stock?: number;
  brand?: string | null;
  rating?: number | null;
  ratingCount?: number;
}

export interface ProductGridProps {
  products: ProductCardData[];
  loading: boolean;
  locale: string;
}

/**
 * Renders the storefront product grid. While `loading`, routes through the
 * existing `ProductSkeletonGrid` so the loading state matches the prior pages.
 */
export function ProductGrid({ products, loading, locale }: ProductGridProps) {
  if (loading) {
    return <ProductSkeletonGrid className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" />;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          productId={product.id}
          slug={product.slug}
          title={product.title}
          price={product.price}
          originalPrice={product.original_price}
          image={product.image ?? null}
          isOnSale={product.is_on_sale}
          isDealOfDay={product.is_deal_of_day}
          stock={product.stock}
          brand={product.brand}
          rating={product.rating}
          ratingCount={product.ratingCount}
          locale={locale}
        />
      ))}
    </div>
  );
}

export default ProductGrid;
