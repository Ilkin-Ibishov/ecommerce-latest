/**
 * Pure stock and availability resolution helper.
 * Determines whether a product is unlimited, out of stock, or low stock,
 * respecting `available_quantity === null` as unlimited (non-tracked).
 */
export interface ProductStockInfo {
  isUnlimited: boolean;
  outOfStock: boolean;
  lowStock: boolean;
  effectiveStock: number | null;
}

export function resolveProductStock(item: {
  stock?: number | null;
  available_quantity?: number | null;
  availableStock?: number | null;
}): ProductStockInfo {
  // If available_quantity or availableStock is explicitly null, the product is non-tracked (unlimited)
  if (item.available_quantity === null || item.availableStock === null) {
    return {
      isUnlimited: true,
      outOfStock: false,
      lowStock: false,
      effectiveStock: null,
    };
  }

  // If available_quantity or availableStock is a numeric value, use that
  const available =
    typeof item.available_quantity === "number"
      ? item.available_quantity
      : typeof item.availableStock === "number"
        ? item.availableStock
        : item.stock;

  if (typeof available === "number") {
    return {
      isUnlimited: false,
      outOfStock: available <= 0,
      lowStock: available > 0 && available < 5,
      effectiveStock: available,
    };
  }

  // Fallback if no numeric value is found
  return {
    isUnlimited: false,
    outOfStock: true,
    lowStock: false,
    effectiveStock: 0,
  };
}
