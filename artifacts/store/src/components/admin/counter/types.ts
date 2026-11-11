// Shapes returned by /admin/counter/* (routes/admin/counter-lookup.ts) and the cart the
// counter screen keeps until Complete (M3a design note §1).

export interface LookupItem {
  variant_id: string;
  sku: string | null;
  title: string;
  image: string | null;
  options: { name: string; value: string }[];
  price: number;
  on_hand: number;
  available: number;
  pack_quantity: number;
  reservations: { reservation_number: string; customer_name: string; quantity: number }[];
}

export interface CounterBundle {
  id: string;
  name: string;
  bundle_price: number | null;
  lines: { variant_id: string; quantity: number; title: string; price: number; on_hand: number }[];
}

export interface CartLine {
  key: string;
  variant_id: string;
  title: string;
  options: string;
  quantity: number;
  unit_price: number;
  on_hand: number;
  available: number;
  reservations: LookupItem["reservations"];
  bundle_id: string | null;
}

export const optionLabel = (options: LookupItem["options"]) =>
  options.map((o) => o.value).filter(Boolean).join(" · ");
