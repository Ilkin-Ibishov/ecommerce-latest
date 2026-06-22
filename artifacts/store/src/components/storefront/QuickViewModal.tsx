import { useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getTranslatedField } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useCart } from "@/lib/cart/context";
import { toastCartAdd } from "@/hooks/use-toast";
import { AnimatedCartButton } from "./AnimatedCartButton";
import { Shimmer } from "@/components/ui/shimmer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface QuickViewModalProps {
  productSlug: string;
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  locale: string;
}

interface QuickViewProduct {
  product_id: string;
  slug: string;
  title: string;
  price: number;
  original_price?: number | null;
  image: string | null;
  stock: number;
}

async function fetchQuickViewProduct(
  slug: string,
  locale: string
): Promise<QuickViewProduct | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("products")
    .select(
      "id, slug, price, original_price, stock, product_images(id, url, alt_text, sort_order), product_translations(id, lang_code, title, description)"
    )
    .eq("slug", slug)
    .single();

  if (!data) return null;

  const sortedImages = [...(data.product_images ?? [])].sort(
    (a: any, b: any) => a.sort_order - b.sort_order
  );

  const title = getTranslatedField(
    data.product_translations as any[],
    locale,
    "title",
    "Product"
  );

  return {
    product_id: data.id,
    slug: data.slug,
    title,
    price: data.price,
    original_price: data.original_price,
    image: sortedImages[0]?.url ?? null,
    stock: data.stock ?? 0,
  };
}

function QuickViewSkeleton() {
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <Shimmer className="w-full sm:w-48 h-48 rounded-md" />
      <div className="flex-1 space-y-3">
        <Shimmer className="h-6 w-3/4 rounded" />
        <Shimmer className="h-5 w-1/3 rounded" />
        <Shimmer className="h-10 w-full rounded" />
      </div>
    </div>
  );
}

export function QuickViewModal({
  productSlug,
  open,
  onClose,
  triggerRef,
  locale,
}: QuickViewModalProps) {
  const { t } = useI18n();
  const { addItem } = useCart();

  const { data: product, isLoading, isError } = useQuery({
    queryKey: ["quick-view", productSlug],
    queryFn: () => fetchQuickViewProduct(productSlug, locale),
    enabled: open,
  });

  // Return focus to trigger on close
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        onClose();
        // Defer focus return to allow dialog close animation to complete
        setTimeout(() => {
          triggerRef.current?.focus();
        }, 0);
      }
    },
    [onClose, triggerRef]
  );

  // Also handle Escape-based close from parent `open` prop turning false
  useEffect(() => {
    if (!open) {
      triggerRef.current?.focus();
    }
  }, [open, triggerRef]);

  const handleAddToCart = useCallback(async () => {
    if (!product) return;
    addItem(
      {
        product_id: product.product_id,
        slug: product.slug,
        title: product.title,
        price: product.price,
        image: product.image,
      },
      1
    );
    toastCartAdd(t, product.title);
  }, [product, addItem, t]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("QuickView.modalTitle")}</DialogTitle>
        </DialogHeader>

        {isLoading && <QuickViewSkeleton />}

        {isError && (
          <div className="text-center py-6">
            <p className="text-destructive text-sm">
              {t("QuickView.loadError")}
            </p>
          </div>
        )}

        {product && !isLoading && !isError && (
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Product Image */}
            <div className="w-full sm:w-48 shrink-0">
              {product.image ? (
                <img
                  src={product.image}
                  alt={product.title}
                  className="w-full h-48 object-cover rounded-md"
                />
              ) : (
                <div className="w-full h-48 bg-muted rounded-md flex items-center justify-center">
                  <span className="text-muted-foreground text-xs">
                    No image
                  </span>
                </div>
              )}
            </div>

            {/* Product Info */}
            <div className="flex-1 flex flex-col gap-3">
              <h3 className="font-semibold text-base leading-tight">
                {product.title}
              </h3>

              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold">
                  {product.price.toFixed(2)} AZN
                </span>
                {product.original_price != null &&
                  product.original_price > product.price && (
                    <span className="text-sm text-muted-foreground line-through">
                      {product.original_price.toFixed(2)} AZN
                    </span>
                  )}
              </div>

              {/* Note: Variant selector placeholder for when variants feature is added */}
              {/* For now, products are treated as single-variant */}

              <div className="mt-auto pt-2">
                <AnimatedCartButton
                  onAdd={handleAddToCart}
                  disabled={product.stock === 0}
                  label={
                    product.stock === 0
                      ? t("StickyBar.outOfStock")
                      : t("StickyBar.addToCart")
                  }
                  size="md"
                  className="w-full"
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
