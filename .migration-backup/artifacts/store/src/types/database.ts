export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type OrderStatus =
  | "pending"
  | "phone_verified"
  | "courier_assigned"
  | "shipped"
  | "delivered"
  | "refused_at_delivery";

export type DiscountType = "percentage" | "fixed";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          phone: string;
          full_name: string | null;
          role: "admin" | "customer";
          created_at: string;
        };
        Insert: {
          id: string;
          phone: string;
          full_name?: string | null;
          role?: "admin" | "customer";
          created_at?: string;
        };
        Update: {
          phone?: string;
          full_name?: string | null;
          role?: "admin" | "customer";
        };
      };
      otp_codes: {
        Row: {
          id: string;
          phone: string;
          code_hash: string;
          expires_at: string;
          attempts: number;
          verified: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          phone: string;
          code_hash: string;
          expires_at: string;
          attempts?: number;
          verified?: boolean;
          created_at?: string;
        };
        Update: {
          attempts?: number;
          verified?: boolean;
        };
      };
      products: {
        Row: {
          id: string;
          sku: string;
          price: number;
          stock: number;
          is_featured: boolean;
          is_on_sale: boolean;
          is_deal_of_day: boolean;
          sort_order: number;
          search_vector: string | null;
          slug: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sku: string;
          price: number;
          stock?: number;
          is_featured?: boolean;
          is_on_sale?: boolean;
          is_deal_of_day?: boolean;
          sort_order?: number;
          slug: string;
        };
        Update: {
          sku?: string;
          price?: number;
          stock?: number;
          is_featured?: boolean;
          is_on_sale?: boolean;
          is_deal_of_day?: boolean;
          sort_order?: number;
          slug?: string;
          updated_at?: string;
        };
      };
      product_images: {
        Row: {
          id: string;
          product_id: string;
          url: string;
          alt_text: string | null;
          sort_order: number;
        };
        Insert: {
          id?: string;
          product_id: string;
          url: string;
          alt_text?: string | null;
          sort_order?: number;
        };
        Update: {
          url?: string;
          alt_text?: string | null;
          sort_order?: number;
        };
      };
      product_translations: {
        Row: {
          id: string;
          product_id: string;
          lang_code: string;
          title: string;
          description: string | null;
          search_vector: string | null;
        };
        Insert: {
          id?: string;
          product_id: string;
          lang_code: string;
          title: string;
          description?: string | null;
        };
        Update: {
          title?: string;
          description?: string | null;
        };
      };
      categories: {
        Row: {
          id: string;
          slug: string;
          icon_url: string | null;
          parent_id: string | null;
        };
        Insert: {
          id?: string;
          slug: string;
          icon_url?: string | null;
          parent_id?: string | null;
        };
        Update: {
          slug?: string;
          icon_url?: string | null;
          parent_id?: string | null;
        };
      };
      category_translations: {
        Row: {
          id: string;
          category_id: string;
          lang_code: string;
          title: string;
        };
        Insert: {
          id?: string;
          category_id: string;
          lang_code: string;
          title: string;
        };
        Update: {
          title?: string;
        };
      };
      cart_items: {
        Row: {
          id: string;
          session_id: string;
          user_id: string | null;
          product_id: string;
          quantity: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id?: string | null;
          product_id: string;
          quantity: number;
        };
        Update: {
          quantity?: number;
        };
      };
      orders: {
        Row: {
          id: string;
          user_id: string;
          status: OrderStatus;
          total_azn: number;
          discount_azn: number;
          coupon_id: string | null;
          delivery_address: string;
          customer_phone: string;
          customer_name: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: OrderStatus;
          total_azn: number;
          discount_azn?: number;
          coupon_id?: string | null;
          delivery_address: string;
          customer_phone: string;
          customer_name: string;
          notes?: string | null;
        };
        Update: {
          status?: OrderStatus;
          updated_at?: string;
        };
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string;
          product_title_snapshot: string;
          product_price_snapshot: number;
          quantity: number;
          line_total: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id: string;
          product_title_snapshot: string;
          product_price_snapshot: number;
          quantity: number;
          line_total: number;
        };
        Update: Record<string, never>;
      };
      coupons: {
        Row: {
          id: string;
          code: string;
          description: string | null;
          discount_type: DiscountType;
          discount_value: number;
          min_order_amount: number | null;
          max_uses: number | null;
          used_count: number;
          max_uses_per_user: number | null;
          scope: "global" | "category" | "product";
          scope_ids: string[] | null;
          starts_at: string | null;
          expires_at: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          description?: string | null;
          discount_type: DiscountType;
          discount_value: number;
          min_order_amount?: number | null;
          max_uses?: number | null;
          used_count?: number;
          max_uses_per_user?: number | null;
          scope?: "global" | "category" | "product";
          scope_ids?: string[] | null;
          starts_at?: string | null;
          expires_at?: string | null;
          is_active?: boolean;
        };
        Update: {
          discount_value?: number;
          min_order_amount?: number | null;
          max_uses?: number | null;
          is_active?: boolean;
          expires_at?: string | null;
        };
      };
      coupon_usages: {
        Row: {
          id: string;
          coupon_id: string;
          user_id: string;
          order_id: string;
          used_at: string;
        };
        Insert: {
          id?: string;
          coupon_id: string;
          user_id: string;
          order_id: string;
          used_at?: string;
        };
        Update: Record<string, never>;
      };
      wishlists: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_id: string;
        };
        Update: Record<string, never>;
      };
      comments: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          content: string;
          approved: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_id: string;
          content: string;
          approved?: boolean;
        };
        Update: {
          approved?: boolean;
          content?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string | null;
          type: string;
          channel: string;
          recipient: string;
          payload: Json;
          status: "pending" | "sent" | "failed" | "retrying";
          attempts: number;
          last_attempt_at: string | null;
          created_at: string;
          sent_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          type: string;
          channel?: string;
          recipient: string;
          payload?: Json;
          status?: "pending" | "sent" | "failed" | "retrying";
          attempts?: number;
        };
        Update: {
          status?: "pending" | "sent" | "failed" | "retrying";
          attempts?: number;
          last_attempt_at?: string | null;
          sent_at?: string | null;
        };
      };
      audit_log: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          entity: string;
          entity_id: string | null;
          changes: Json | null;
          ip_address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          changes?: Json | null;
          ip_address?: string | null;
        };
        Update: Record<string, never>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      search_products: {
        Args: { query_text: string; lang_code: string };
        Returns: {
          id: string;
          title: string;
          description: string;
          price: number;
          slug: string;
          rank: number;
        }[];
      };
    };
    Enums: {
      order_status: OrderStatus;
    };
  };
}
