export interface NeedsYouItem {
  key: string;
  count: number;
}

export interface InboxEvent {
  id: string;
  kind: "order_created" | "counter_sale_voided" | "counter_sale_mismatch" | "stocktake_posted";
  time: string;
  actor_id: string | null;
  actor_name: string | null;
  unread: boolean;
  order_id?: string | null;
  customer_name?: string | null;
  sale_number?: number | null;
  void_reason?: string | null;
  total_mismatch?: boolean | null;
  price_mismatch?: boolean | null;
  reservation_override?: boolean | null;
  mismatch_flags?: string[] | null;
  stocktake_number?: string | null;
  title?: string | null;
  link?: string | null;
}

export interface InboxResponse {
  needs_you: NeedsYouItem[];
  events: InboxEvent[] | null;
  seen_at: string | null;
}
