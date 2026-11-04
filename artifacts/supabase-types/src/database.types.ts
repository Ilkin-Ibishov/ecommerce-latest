// =============================================================================
// Supabase Database types
// -----------------------------------------------------------------------------
// GENERATION METHOD: live schema (Supabase CLI equivalent)
//
// These types were generated from the LIVE Supabase schema, equivalent to:
//
//   supabase gen types typescript --project-id "$SUPABASE_PROJECT_ID" \
//     > artifacts/supabase-types/src/database.types.ts
//
// The local `supabase` CLI was not available on this machine, so the types
// were produced from the connected live project schema (the same output the
// CLI `gen types typescript` command emits). This reflects the real database,
// which is ahead of the checked-in `supabase/schema.sql` snapshot (it includes
// tables/columns such as `products.brand`, `product_specs`, `pages`,
// `page_translations`, `site_settings`, and `banners`).
//
// DO NOT EDIT BY HAND. Regenerate whenever the schema changes — see README.md.
// =============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          changes: Json | null;
          created_at: string;
          entity: string;
          entity_id: string | null;
          id: string;
          ip_address: unknown;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          changes?: Json | null;
          created_at?: string;
          entity: string;
          entity_id?: string | null;
          id?: string;
          ip_address?: unknown;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          changes?: Json | null;
          created_at?: string;
          entity?: string;
          entity_id?: string | null;
          id?: string;
          ip_address?: unknown;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      banners: {
        Row: {
          active: boolean;
          created_at: string;
          cta_text: string | null;
          cta_url: string | null;
          id: string;
          image_url: string | null;
          sort_order: number;
          subtitle: string | null;
          title: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          cta_text?: string | null;
          cta_url?: string | null;
          id?: string;
          image_url?: string | null;
          sort_order?: number;
          subtitle?: string | null;
          title?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          cta_text?: string | null;
          cta_url?: string | null;
          id?: string;
          image_url?: string | null;
          sort_order?: number;
          subtitle?: string | null;
          title?: string;
        };
        Relationships: [];
      };
      brand_entries: {
        Row: {
          id: string;
          name: string;
          logo_url: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          logo_url: string;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          logo_url?: string;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      cart_items: {
        Row: {
          created_at: string;
          id: string;
          product_id: string;
          quantity: number;
          session_id: string;
          user_id: string | null;
          variant_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          product_id: string;
          quantity?: number;
          session_id: string;
          user_id?: string | null;
          variant_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          product_id?: string;
          quantity?: number;
          session_id?: string;
          user_id?: string | null;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cart_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cart_items_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          icon_url: string | null;
          id: string;
          parent_id: string | null;
          slug: string;
        };
        Insert: {
          icon_url?: string | null;
          id?: string;
          parent_id?: string | null;
          slug: string;
        };
        Update: {
          icon_url?: string | null;
          id?: string;
          parent_id?: string | null;
          slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      category_translations: {
        Row: {
          category_id: string;
          id: string;
          lang_code: string;
          title: string;
        };
        Insert: {
          category_id: string;
          id?: string;
          lang_code: string;
          title: string;
        };
        Update: {
          category_id?: string;
          id?: string;
          lang_code?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "category_translations_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      comments: {
        Row: {
          approved: boolean;
          content: string;
          created_at: string;
          id: string;
          product_id: string;
          rating: number | null;
          user_id: string;
        };
        Insert: {
          approved?: boolean;
          content: string;
          created_at?: string;
          id?: string;
          product_id: string;
          rating?: number | null;
          user_id: string;
        };
        Update: {
          approved?: boolean;
          content?: string;
          created_at?: string;
          id?: string;
          product_id?: string;
          rating?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      coupon_usages: {
        Row: {
          coupon_id: string;
          id: string;
          order_id: string;
          used_at: string;
          user_id: string;
        };
        Insert: {
          coupon_id: string;
          id?: string;
          order_id: string;
          used_at?: string;
          user_id: string;
        };
        Update: {
          coupon_id?: string;
          id?: string;
          order_id?: string;
          used_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coupon_usages_coupon_id_fkey";
            columns: ["coupon_id"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coupon_usages_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coupon_usages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      coupons: {
        Row: {
          code: string;
          created_at: string;
          description: string | null;
          discount_type: string;
          discount_value: number;
          expires_at: string | null;
          id: string;
          is_active: boolean;
          max_uses: number | null;
          max_uses_per_user: number | null;
          min_order_amount: number | null;
          scope: string;
          scope_ids: string[] | null;
          starts_at: string | null;
          used_count: number;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string | null;
          discount_type: string;
          discount_value: number;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          max_uses?: number | null;
          max_uses_per_user?: number | null;
          min_order_amount?: number | null;
          scope?: string;
          scope_ids?: string[] | null;
          starts_at?: string | null;
          used_count?: number;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string | null;
          discount_type?: string;
          discount_value?: number;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          max_uses?: number | null;
          max_uses_per_user?: number | null;
          min_order_amount?: number | null;
          scope?: string;
          scope_ids?: string[] | null;
          starts_at?: string | null;
          used_count?: number;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          attempts: number;
          channel: string;
          created_at: string;
          id: string;
          last_attempt_at: string | null;
          payload: Json;
          recipient: string;
          sent_at: string | null;
          status: string;
          type: string;
          user_id: string | null;
        };
        Insert: {
          attempts?: number;
          channel?: string;
          created_at?: string;
          id?: string;
          last_attempt_at?: string | null;
          payload?: Json;
          recipient: string;
          sent_at?: string | null;
          status?: string;
          type: string;
          user_id?: string | null;
        };
        Update: {
          attempts?: number;
          channel?: string;
          created_at?: string;
          id?: string;
          last_attempt_at?: string | null;
          payload?: Json;
          recipient?: string;
          sent_at?: string | null;
          status?: string;
          type?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          id: string;
          line_total: number;
          order_id: string;
          product_id: string;
          product_price_snapshot: number;
          product_title_snapshot: string;
          quantity: number;
          sku_snapshot: string | null;
          variant_id: string | null;
          variant_title_snapshot: string | null;
        };
        Insert: {
          id?: string;
          line_total: number;
          order_id: string;
          product_id: string;
          product_price_snapshot: number;
          product_title_snapshot: string;
          quantity: number;
          sku_snapshot?: string | null;
          variant_id?: string | null;
          variant_title_snapshot?: string | null;
        };
        Update: {
          id?: string;
          line_total?: number;
          order_id?: string;
          product_id?: string;
          product_price_snapshot?: number;
          product_title_snapshot?: string;
          quantity?: number;
          sku_snapshot?: string | null;
          variant_id?: string | null;
          variant_title_snapshot?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          admin_notes: string | null;
          coupon_id: string | null;
          created_at: string;
          customer_name: string;
          customer_phone: string;
          delivery_address: string;
          discount_azn: number;
          id: string;
          notes: string | null;
          status: Database["public"]["Enums"]["order_status"];
          total_azn: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          admin_notes?: string | null;
          coupon_id?: string | null;
          created_at?: string;
          customer_name: string;
          customer_phone: string;
          delivery_address: string;
          discount_azn?: number;
          id?: string;
          notes?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          total_azn: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          admin_notes?: string | null;
          coupon_id?: string | null;
          created_at?: string;
          customer_name?: string;
          customer_phone?: string;
          delivery_address?: string;
          discount_azn?: number;
          id?: string;
          notes?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          total_azn?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_coupon_id_fkey";
            columns: ["coupon_id"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      otp_codes: {
        Row: {
          attempts: number;
          code_hash: string;
          created_at: string;
          expires_at: string;
          id: string;
          phone: string;
          verified: boolean;
        };
        Insert: {
          attempts?: number;
          code_hash: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          phone: string;
          verified?: boolean;
        };
        Update: {
          attempts?: number;
          code_hash?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          phone?: string;
          verified?: boolean;
        };
        Relationships: [];
      };
      otp_requests: {
        Row: {
          attempts: number;
          code_hash: string;
          created_at: string;
          expires_at: string;
          id: string;
          phone: string;
        };
        Insert: {
          attempts?: number;
          code_hash: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          phone: string;
        };
        Update: {
          attempts?: number;
          code_hash?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          phone?: string;
        };
        Relationships: [];
      };
      page_translations: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          locale: string;
          meta_description: string | null;
          meta_title: string | null;
          page_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          content?: string;
          created_at?: string;
          id?: string;
          locale: string;
          meta_description?: string | null;
          meta_title?: string | null;
          page_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          locale?: string;
          meta_description?: string | null;
          meta_title?: string | null;
          page_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "page_translations_page_id_fkey";
            columns: ["page_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id"];
          },
        ];
      };
      pages: {
        Row: {
          created_at: string;
          id: string;
          is_system: boolean;
          published: boolean;
          show_in_footer: boolean;
          show_in_header: boolean;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_system?: boolean;
          published?: boolean;
          show_in_footer?: boolean;
          show_in_header?: boolean;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_system?: boolean;
          published?: boolean;
          show_in_footer?: boolean;
          show_in_header?: boolean;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_categories: {
        Row: {
          category_id: string;
          product_id: string;
        };
        Insert: {
          category_id: string;
          product_id: string;
        };
        Update: {
          category_id?: string;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_categories_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_images: {
        Row: {
          alt_text: string | null;
          id: string;
          product_id: string;
          sort_order: number;
          source: string;
          url: string;
        };
        Insert: {
          alt_text?: string | null;
          id?: string;
          product_id: string;
          sort_order?: number;
          source?: string;
          url: string;
        };
        Update: {
          alt_text?: string | null;
          id?: string;
          product_id?: string;
          sort_order?: number;
          source?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_specs: {
        Row: {
          id: string;
          product_id: string;
          sort_order: number;
          spec_key: string;
          spec_value: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          sort_order?: number;
          spec_key: string;
          spec_value: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          sort_order?: number;
          spec_key?: string;
          spec_value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_specs_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_translations: {
        Row: {
          description: string | null;
          id: string;
          lang_code: string;
          product_id: string;
          search_vector: unknown;
          title: string;
        };
        Insert: {
          description?: string | null;
          id?: string;
          lang_code: string;
          product_id: string;
          search_vector?: unknown;
          title: string;
        };
        Update: {
          description?: string | null;
          id?: string;
          lang_code?: string;
          product_id?: string;
          search_vector?: unknown;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_translations_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_option_types: {
        Row: {
          id: string;
          name: string;
          product_id: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          name: string;
          product_id: string;
          sort_order?: number;
        };
        Update: {
          id?: string;
          name?: string;
          product_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "product_option_types_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_option_values: {
        Row: {
          id: string;
          option_type_id: string;
          sort_order: number;
          value: string;
        };
        Insert: {
          id?: string;
          option_type_id: string;
          sort_order?: number;
          value: string;
        };
        Update: {
          id?: string;
          option_type_id?: string;
          sort_order?: number;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_option_values_option_type_id_fkey";
            columns: ["option_type_id"];
            isOneToOne: false;
            referencedRelation: "product_option_types";
            referencedColumns: ["id"];
          },
        ];
      };
      product_variants: {
        Row: {
          barcode: string | null;
          created_at: string;
          id: string;
          is_default: boolean;
          low_stock_threshold: number | null;
          on_hand: number;
          price: number;
          product_id: string;
          sku: string | null;
          sort_order: number;
          track_stock: boolean;
          unit_of_measure: string;
          updated_at: string;
        };
        Insert: {
          barcode?: string | null;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          low_stock_threshold?: number | null;
          on_hand?: number;
          price: number;
          product_id: string;
          sku?: string | null;
          sort_order?: number;
          track_stock?: boolean;
          unit_of_measure?: string;
          updated_at?: string;
        };
        Update: {
          barcode?: string | null;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          low_stock_threshold?: number | null;
          on_hand?: number;
          price?: number;
          product_id?: string;
          sku?: string | null;
          sort_order?: number;
          track_stock?: boolean;
          unit_of_measure?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          correlation_id: string | null;

          actor_id: string | null;
          created_at: string;
          id: string;
          location_id: string | null;
          note: string | null;
          quantity_delta: number;
          reason: Database["public"]["Enums"]["stock_movement_reason"];
          reference_id: string | null;
          reference_type: string | null;
          variant_id: string;
          posting_date: string;
          transaction_id: string | null;
          negative_stock_override: boolean;
        };
        Insert: {
          correlation_id?: string | null;

          actor_id?: string | null;
          created_at?: string;
          id?: string;
          location_id?: string | null;
          note?: string | null;
          quantity_delta: number;
          reason: Database["public"]["Enums"]["stock_movement_reason"];
          reference_id?: string | null;
          reference_type?: string | null;
          variant_id: string;
          posting_date?: string;
          transaction_id?: string | null;
          negative_stock_override?: boolean;
        };
        Update: {
          correlation_id?: string | null;

          actor_id?: string | null;
          created_at?: string;
          id?: string;
          location_id?: string | null;
          note?: string | null;
          quantity_delta?: number;
          reason?: Database["public"]["Enums"]["stock_movement_reason"];
          reference_id?: string | null;
          reference_type?: string | null;
          variant_id?: string;
          posting_date?: string;
          transaction_id?: string | null;
          negative_stock_override?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      variant_barcodes: {
        Row: {
          barcode: string;
          created_at: string;
          id: string;
          is_primary: boolean;
          source: string;
          variant_id: string;
          pack_quantity: number;
          pack_unit: string;
        };
        Insert: {
          barcode: string;
          created_at?: string;
          id?: string;
          is_primary?: boolean;
          source?: string;
          variant_id: string;
          pack_quantity?: number;
          pack_unit?: string;
        };
        Update: {
          barcode?: string;
          created_at?: string;
          id?: string;
          is_primary?: boolean;
          source?: string;
          variant_id?: string;
          pack_quantity?: number;
          pack_unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "variant_barcodes_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      variant_costs: {
        Row: {
          cost_price: number;
          opening_cost: number | null;
          updated_at: string;
          variant_id: string;
        };
        Insert: {
          cost_price?: number;
          opening_cost?: number | null;
          updated_at?: string;
          variant_id: string;
        };
        Update: {
          cost_price?: number;
          opening_cost?: number | null;
          updated_at?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "variant_costs_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: true;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      variant_option_values: {
        Row: {
          option_value_id: string;
          variant_id: string;
        };
        Insert: {
          option_value_id: string;
          variant_id: string;
        };
        Update: {
          option_value_id?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "variant_option_values_option_value_id_fkey";
            columns: ["option_value_id"];
            isOneToOne: false;
            referencedRelation: "product_option_values";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "variant_option_values_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          brand: string | null;
          created_at: string;
          id: string;
          is_deal_of_day: boolean;
          is_featured: boolean;
          is_on_sale: boolean;
          original_price: number | null;
          price: number;
          search_text: string | null;
          search_vector: unknown;
          sku: string;
          slug: string;
          sort_order: number;
          stock: number;
          updated_at: string;
        };
        Insert: {
          brand?: string | null;
          created_at?: string;
          id?: string;
          is_deal_of_day?: boolean;
          is_featured?: boolean;
          is_on_sale?: boolean;
          original_price?: number | null;
          price: number;
          search_text?: string | null;
          search_vector?: unknown;
          sku: string;
          slug: string;
          sort_order?: number;
          stock?: number;
          updated_at?: string;
        };
        Update: {
          brand?: string | null;
          created_at?: string;
          id?: string;
          is_deal_of_day?: boolean;
          is_featured?: boolean;
          is_on_sale?: boolean;
          original_price?: number | null;
          price?: number;
          search_text?: string | null;
          search_vector?: unknown;
          sku?: string;
          slug?: string;
          sort_order?: number;
          stock?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      site_settings: {
        Row: {
          colors: Json;
          contact: Json;
          created_at: string;
          favicon_url: string | null;
          fonts: Json;
          footer_text: Json;
          id: string;
          logo_url: string | null;
          store_name: Json;
          updated_at: string;
          working_hours: Json;
          allow_negative_stock: boolean;
        };
        Insert: {
          colors?: Json;
          contact?: Json;
          created_at?: string;
          favicon_url?: string | null;
          fonts?: Json;
          footer_text?: Json;
          id?: string;
          logo_url?: string | null;
          store_name?: Json;
          updated_at?: string;
          working_hours?: Json;
          allow_negative_stock?: boolean;
        };
        Update: {
          colors?: Json;
          contact?: Json;
          created_at?: string;
          favicon_url?: string | null;
          fonts?: Json;
          footer_text?: Json;
          id?: string;
          logo_url?: string | null;
          store_name?: Json;
          updated_at?: string;
          working_hours?: Json;
          allow_negative_stock?: boolean;
        };
        Relationships: [];
      };
      store_settings: {
        Row: {
          description: string | null;
          key: string;
          updated_at: string | null;
          value: string;
        };
        Insert: {
          description?: string | null;
          key: string;
          updated_at?: string | null;
          value: string;
        };
        Update: {
          description?: string | null;
          key?: string;
          updated_at?: string | null;
          value?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          created_at: string;
          default_address: string | null;
          full_name: string | null;
          id: string;
          phone: string;
          role: string;
        };
        Insert: {
          created_at?: string;
          default_address?: string | null;
          full_name?: string | null;
          id: string;
          phone: string;
          role?: string;
        };
        Update: {
          created_at?: string;
          default_address?: string | null;
          full_name?: string | null;
          id?: string;
          phone?: string;
          role?: string;
        };
        Relationships: [];
      };
      wishlists: {
        Row: {
          created_at: string;
          id: string;
          product_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          product_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          product_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wishlists_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wishlists_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          id: string;
          name: string;
          contact_info: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          contact_info?: string | null;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          contact_info?: string | null;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      goods_receipts: {
        Row: {
          id: string;
          receipt_number: string;
          supplier_id: string | null;
          posting_date: string;
          reference_note: string | null;
          note: string | null;
          status: "draft" | "posted" | "reversed";
          transaction_id: string | null;
          created_by: string | null;
          posted_by: string | null;
          posted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          receipt_number: string;
          supplier_id?: string | null;
          posting_date?: string;
          reference_note?: string | null;
          note?: string | null;
          status?: "draft" | "posted" | "reversed";
          transaction_id?: string | null;
          created_by?: string | null;
          posted_by?: string | null;
          posted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          receipt_number?: string;
          supplier_id?: string | null;
          posting_date?: string;
          reference_note?: string | null;
          note?: string | null;
          status?: "draft" | "posted" | "reversed";
          transaction_id?: string | null;
          created_by?: string | null;
          posted_by?: string | null;
          posted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "goods_receipts_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      goods_receipt_costs: {
        Row: {
          receipt_id: string;
          additional_costs: number | null;
          created_at: string;
        };
        Insert: {
          receipt_id: string;
          additional_costs?: number | null;
          created_at?: string;
        };
        Update: {
          receipt_id?: string;
          additional_costs?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "goods_receipt_costs_receipt_id_fkey";
            columns: ["receipt_id"];
            isOneToOne: true;
            referencedRelation: "goods_receipts";
            referencedColumns: ["id"];
          },
        ];
      };
      goods_receipt_lines: {
        Row: {
          id: string;
          receipt_id: string;
          variant_id: string;
          quantity: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          receipt_id: string;
          variant_id: string;
          quantity: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          receipt_id?: string;
          variant_id?: string;
          quantity?: number;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "goods_receipt_lines_receipt_id_fkey";
            columns: ["receipt_id"];
            isOneToOne: false;
            referencedRelation: "goods_receipts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "goods_receipt_lines_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      goods_receipt_line_costs: {
        Row: {
          line_id: string;
          unit_cost: number;
          created_at: string;
        };
        Insert: {
          line_id: string;
          unit_cost: number;
          created_at?: string;
        };
        Update: {
          line_id?: string;
          unit_cost?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "goods_receipt_line_costs_line_id_fkey";
            columns: ["line_id"];
            isOneToOne: true;
            referencedRelation: "goods_receipt_lines";
            referencedColumns: ["id"];
          },
        ];
      };
      stocktakes: {
        Row: {
          id: string;
          stocktake_number: string;
          title: string;
          status: "draft" | "posted" | "cancelled";
          is_opening_count: boolean;
          posting_date: string | null;
          transaction_id: string | null;
          created_by: string | null;
          posted_by: string | null;
          posted_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          stocktake_number: string;
          title: string;
          status?: "draft" | "posted" | "cancelled";
          is_opening_count?: boolean;
          posting_date?: string | null;
          transaction_id?: string | null;
          created_by?: string | null;
          posted_by?: string | null;
          posted_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          stocktake_number?: string;
          title?: string;
          status?: "draft" | "posted" | "cancelled";
          is_opening_count?: boolean;
          posting_date?: string | null;
          transaction_id?: string | null;
          created_by?: string | null;
          posted_by?: string | null;
          posted_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      stocktake_lines: {
        Row: {
          id: string;
          stocktake_id: string;
          variant_id: string;
          counter_id: string;
          counted_quantity: number;
          location_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          stocktake_id: string;
          variant_id: string;
          counter_id: string;
          counted_quantity: number;
          location_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          stocktake_id?: string;
          variant_id?: string;
          counter_id?: string;
          counted_quantity?: number;
          location_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      stocktake_line_snapshots: {
        Row: {
          line_id: string;
          snapshot_on_hand: number;
          captured_at: string;
        };
        Insert: {
          line_id: string;
          snapshot_on_hand: number;
          captured_at?: string;
        };
        Update: {
          line_id?: string;
          snapshot_on_hand?: number;
          captured_at?: string;
        };
        Relationships: [];
      };
      stocktake_opening_costs: {
        Row: {
          stocktake_id: string;
          variant_id: string;
          opening_unit_cost: number;
          created_at: string;
        };
        Insert: {
          stocktake_id: string;
          variant_id: string;
          opening_unit_cost: number;
          created_at?: string;
        };
        Update: {
          stocktake_id?: string;
          variant_id?: string;
          opening_unit_cost?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      stocktake_resolutions: {
        Row: {
          stocktake_id: string;
          variant_id: string;
          resolution_type: "sum" | "override";
          chosen_line_id: string | null;
          resolved_quantity: number;
          resolved_line_count: number;
          resolved_latest_line_at: string;
          resolved_by: string | null;
          resolved_at: string;
        };
        Insert: {
          stocktake_id: string;
          variant_id: string;
          resolution_type: "sum" | "override";
          chosen_line_id?: string | null;
          resolved_quantity: number;
          resolved_line_count?: number;
          resolved_latest_line_at?: string;
          resolved_by?: string | null;
          resolved_at?: string;
        };
        Update: {
          stocktake_id?: string;
          variant_id?: string;
          resolution_type?: "sum" | "override";
          chosen_line_id?: string | null;
          resolved_quantity?: number;
          resolved_line_count?: number;
          resolved_latest_line_at?: string;
          resolved_by?: string | null;
          resolved_at?: string;
        };
        Relationships: [];
      };
      stock_movement_costs: {
        Row: {
          movement_id: string;
          variant_id: string;
          posting_date: string;
          created_at: string;
          quantity_delta: number;
          unit_cost: number;
          total_cost: number;
          running_quantity: number;
          running_cost_basis_qty: number;
          running_avg_cost: number;
          has_unknown_cost_basis: boolean;
          computed_at: string;
        };
        Insert: {
          movement_id: string;
          variant_id: string;
          posting_date: string;
          created_at: string;
          quantity_delta: number;
          unit_cost: number;
          total_cost: number;
          running_quantity: number;
          running_cost_basis_qty: number;
          running_avg_cost: number;
          has_unknown_cost_basis?: boolean;
          computed_at?: string;
        };
        Update: {
          movement_id?: string;
          variant_id?: string;
          posting_date?: string;
          created_at?: string;
          quantity_delta?: number;
          unit_cost?: number;
          total_cost?: number;
          running_quantity?: number;
          running_cost_basis_qty?: number;
          running_avg_cost?: number;
          has_unknown_cost_basis?: boolean;
          computed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movement_costs_movement_id_fkey";
            columns: ["movement_id"];
            isOneToOne: true;
            referencedRelation: "stock_movements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movement_costs_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      reservations: {
        Row: {
          id: string;
          reservation_number: string;
          variant_id: string;
          quantity: number;
          customer_name: string;
          customer_phone: string;
          hold_type: "deposit" | "order_hold" | "cart_hold";
          status: "active" | "fulfilled" | "released" | "expired";
          agreed_price: number;
          paid_amount: number;
          notes: string | null;
          expires_at: string | null;
          created_by: string;
          fulfilled_by: string | null;
          fulfilled_at: string | null;
          released_by: string | null;
          released_at: string | null;
          release_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          reservation_number: string;
          variant_id: string;
          quantity: number;
          customer_name: string;
          customer_phone: string;
          hold_type?: "deposit" | "order_hold" | "cart_hold";
          status?: "active" | "fulfilled" | "released" | "expired";
          agreed_price: number;
          paid_amount?: number;
          notes?: string | null;
          expires_at?: string | null;
          created_by: string;
          fulfilled_by?: string | null;
          fulfilled_at?: string | null;
          released_by?: string | null;
          released_at?: string | null;
          release_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          reservation_number?: string;
          variant_id?: string;
          quantity?: number;
          customer_name?: string;
          customer_phone?: string;
          hold_type?: "deposit" | "order_hold" | "cart_hold";
          status?: "active" | "fulfilled" | "released" | "expired";
          agreed_price?: number;
          paid_amount?: number;
          notes?: string | null;
          expires_at?: string | null;
          created_by?: string;
          fulfilled_by?: string | null;
          fulfilled_at?: string | null;
          released_by?: string | null;
          released_at?: string | null;
          release_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reservations_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reservations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      fulfil_reservation: {
        Args: {
          p_actor_id: string;
          p_final_payment?: number;
          p_reservation_id: string;
        };
        Returns: Json;
      };
      decrement_order_stock: {
        Args: {
          p_order_id: string;
          p_lines: { variant_id: string; quantity: number }[];
          p_actor_id?: string | null;
        };
        Returns: undefined;
      };
      decrement_stock_safe: {
        Args: {
          p_actor_id?: string | null;
          p_product_id: string;
          p_qty: number;
          p_reference_id?: string | null;
        };
        Returns: undefined;
      };
      increment_stock: {
        Args: {
          p_actor_id?: string | null;
          p_product_id: string;
          p_qty: number;
          p_reference_id?: string | null;
        };
        Returns: undefined;
      };

      search_products: {
        Args: { lang_code: string; query_text: string };
        Returns: {
          description: string;
          id: string;
          price: number;
          rank: number;
          slug: string;
          title: string;
        }[];
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
    };
    Enums: {
      stock_movement_reason:
        | "goods_receipt"
        | "online_sale"
        | "counter_sale"
        | "customer_return"
        | "return_to_supplier"
        | "damage_write_off"
        | "stocktake_correction"
        | "manual_adjustment"
        | "opening_balance"
        | "assembly_consume"
        | "assembly_produce";

      order_status:
        | "pending"
        | "phone_verified"
        | "courier_assigned"
        | "shipped"
        | "delivered"
        | "refused_at_delivery";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      order_status: [
        "pending",
        "phone_verified",
        "courier_assigned",
        "shipped",
        "delivered",
        "refused_at_delivery",
      ],
    },
  },
} as const;
