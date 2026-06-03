export interface CartEntry {
  product_id: string;
  quantity: number;
}

export interface MergeResult {
  mergedCart: CartEntry[];
  itemsMerged: number;
}

export const MAX_QUANTITY = 99;

export function mergeGuestCart(
  userCart: CartEntry[],
  guestCart: CartEntry[],
): MergeResult {
  const result = new Map<string, number>(
    userCart.map((item) => [item.product_id, item.quantity]),
  );

  let itemsMerged = 0;

  for (const guestItem of guestCart) {
    const existing = result.get(guestItem.product_id) ?? 0;
    result.set(
      guestItem.product_id,
      Math.min(existing + guestItem.quantity, MAX_QUANTITY),
    );
    itemsMerged++;
  }

  return {
    mergedCart: Array.from(result.entries()).map(([product_id, quantity]) => ({
      product_id,
      quantity,
    })),
    itemsMerged,
  };
}
