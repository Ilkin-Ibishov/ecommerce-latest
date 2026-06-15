// =============================================================================
// Control_Plane Database types
// -----------------------------------------------------------------------------
// This type represents the CONTROL_PLANE Supabase project's schema — completely
// separate from the store `Database` type.
//
// GENERATION METHOD: hand-written from design doc (Phase 0 tables).
// Future: regenerate via `pnpm --filter @workspace/supabase-types run gen:control-plane`
// once the Control_Plane Supabase project is provisioned.
//
// Phase 0 tables: stores, platform_admins, control_plane_sessions, audit_log
// Phase 1 tables: store_metrics_cache, platform_notifications, platform_notification_targets, platform_notification_reads
// Phase 2 tables: subscription_plans, invoices, grace_periods, billing_config
// Phase 3 tables: notification_deliveries, notification_preferences, impersonation_sessions, store_offboarding
// =============================================================================

export type ControlPlanJson =
  | string
  | number
  | boolean
  | null
  | { [key: string]: ControlPlanJson | undefined }
  | ControlPlanJson[];

export type ControlPlaneDatabase = {
  public: {
    Tables: {
      stores: {
        Row: {
          id: string;
          name: string;
          name_normalized: string;
          instance_url: string;
          metrics_endpoint_url: string;
          per_store_credential_hash: string;
          owner_email: string;
          owner_name: string | null;
          locale: string;
          platform_status: "onboarding" | "active" | "suspended" | "disabled";
          subscription_status: "trialing" | "active" | "past_due" | "cancelled";
          subscription_plan_id: string | null;
          billing_anchor: string | null;
          grace_period_days: number | null;
          suspended_at: string | null;
          status_before_suspend: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          name_normalized: string;
          instance_url: string;
          metrics_endpoint_url: string;
          per_store_credential_hash: string;
          owner_email: string;
          owner_name?: string | null;
          locale?: string;
          platform_status?: "onboarding" | "active" | "suspended" | "disabled";
          subscription_status?: "trialing" | "active" | "past_due" | "cancelled";
          subscription_plan_id?: string | null;
          billing_anchor?: string | null;
          grace_period_days?: number | null;
          suspended_at?: string | null;
          status_before_suspend?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          name_normalized?: string;
          instance_url?: string;
          metrics_endpoint_url?: string;
          per_store_credential_hash?: string;
          owner_email?: string;
          owner_name?: string | null;
          locale?: string;
          platform_status?: "onboarding" | "active" | "suspended" | "disabled";
          subscription_status?: "trialing" | "active" | "past_due" | "cancelled";
          subscription_plan_id?: string | null;
          billing_anchor?: string | null;
          grace_period_days?: number | null;
          suspended_at?: string | null;
          status_before_suspend?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          user_id: string;
          mfa_enabled: boolean;
          created_at: string;
        };
        Insert: {
          user_id: string;
          mfa_enabled?: boolean;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          mfa_enabled?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      control_plane_sessions: {
        Row: {
          id: string;
          user_id: string;
          mfa_verified: boolean;
          started_at: string;
          last_seen_at: string;
          ended_at: string | null;
          end_reason: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          mfa_verified?: boolean;
          started_at?: string;
          last_seen_at?: string;
          ended_at?: string | null;
          end_reason?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          mfa_verified?: boolean;
          started_at?: string;
          last_seen_at?: string;
          ended_at?: string | null;
          end_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "control_plane_sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "platform_admins";
            referencedColumns: ["user_id"];
          }
        ];
      };
      store_metrics_cache: {
        Row: {
          store_id: string;
          order_count: number | null;
          revenue_total: number | null;
          traffic_count: number | null;
          quota_usage: ControlPlanJson;
          available: boolean;
          fetched_at: string | null;
        };
        Insert: {
          store_id: string;
          order_count?: number | null;
          revenue_total?: number | null;
          traffic_count?: number | null;
          quota_usage?: ControlPlanJson;
          available?: boolean;
          fetched_at?: string | null;
        };
        Update: {
          store_id?: string;
          order_count?: number | null;
          revenue_total?: number | null;
          traffic_count?: number | null;
          quota_usage?: ControlPlanJson;
          available?: boolean;
          fetched_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "store_metrics_cache_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: true;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      platform_notifications: {
        Row: {
          id: string;
          type: string;
          scope: "single" | "set" | "broadcast";
          mandatory: boolean;
          multichannel: boolean;
          content: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          type: string;
          scope: "single" | "set" | "broadcast";
          mandatory?: boolean;
          multichannel?: boolean;
          content: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          type?: string;
          scope?: "single" | "set" | "broadcast";
          mandatory?: boolean;
          multichannel?: boolean;
          content?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_notifications_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "platform_admins";
            referencedColumns: ["user_id"];
          }
        ];
      };
      platform_notification_targets: {
        Row: {
          notification_id: string;
          store_id: string;
        };
        Insert: {
          notification_id: string;
          store_id: string;
        };
        Update: {
          notification_id?: string;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pnt_notification_id_fkey";
            columns: ["notification_id"];
            isOneToOne: false;
            referencedRelation: "platform_notifications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pnt_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      platform_notification_reads: {
        Row: {
          notification_id: string;
          store_id: string;
          read_at: string;
        };
        Insert: {
          notification_id: string;
          store_id: string;
          read_at?: string;
        };
        Update: {
          notification_id?: string;
          store_id?: string;
          read_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pnr_notification_id_fkey";
            columns: ["notification_id"];
            isOneToOne: false;
            referencedRelation: "platform_notifications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pnr_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      audit_log: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          entity: string;
          entity_id: string | null;
          changes: ControlPlanJson;
          scope: "platform";
          store_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          changes?: ControlPlanJson;
          scope?: "platform";
          store_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          action?: string;
          entity?: string;
          entity_id?: string | null;
          changes?: ControlPlanJson;
          scope?: "platform";
          store_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      subscription_plans: {
        Row: {
          id: string;
          name: string;
          name_normalized: string;
          price: number;
          billing_interval: "monthly" | "yearly";
          feature_flags: ControlPlanJson;
          quota_limits: ControlPlanJson;
          archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          name_normalized: string;
          price: number;
          billing_interval: "monthly" | "yearly";
          feature_flags?: ControlPlanJson;
          quota_limits?: ControlPlanJson;
          archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          name_normalized?: string;
          price?: number;
          billing_interval?: "monthly" | "yearly";
          feature_flags?: ControlPlanJson;
          quota_limits?: ControlPlanJson;
          archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          store_id: string;
          plan_id: string;
          period_start: string;
          period_end: string;
          issue_date: string;
          due_date: string;
          amount: number;
          status: "open" | "paid" | "void";
          paid_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          plan_id: string;
          period_start: string;
          period_end: string;
          issue_date: string;
          due_date: string;
          amount: number;
          status?: "open" | "paid" | "void";
          paid_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          plan_id?: string;
          period_start?: string;
          period_end?: string;
          issue_date?: string;
          due_date?: string;
          amount?: number;
          status?: "open" | "paid" | "void";
          paid_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "subscription_plans";
            referencedColumns: ["id"];
          }
        ];
      };
      grace_periods: {
        Row: {
          id: string;
          store_id: string;
          invoice_id: string;
          started_at: string;
          ends_at: string;
          resolved: boolean;
        };
        Insert: {
          id?: string;
          store_id: string;
          invoice_id: string;
          started_at: string;
          ends_at: string;
          resolved?: boolean;
        };
        Update: {
          id?: string;
          store_id?: string;
          invoice_id?: string;
          started_at?: string;
          ends_at?: string;
          resolved?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "grace_periods_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "grace_periods_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          }
        ];
      };
      billing_config: {
        Row: {
          id: number;
          trial_days: number;
          due_days: number;
          grace_period_days: number;
          currency: string;
        };
        Insert: {
          id?: number;
          trial_days?: number;
          due_days?: number;
          grace_period_days?: number;
          currency?: string;
        };
        Update: {
          id?: number;
          trial_days?: number;
          due_days?: number;
          grace_period_days?: number;
          currency?: string;
        };
        Relationships: [];
      };
      notification_deliveries: {
        Row: {
          id: string;
          notification_id: string;
          store_id: string;
          channel: "in_app" | "email";
          attempt_no: number;
          outcome: "succeeded" | "failed";
          error: string | null;
          attempted_at: string;
        };
        Insert: {
          id?: string;
          notification_id: string;
          store_id: string;
          channel: "in_app" | "email";
          attempt_no?: number;
          outcome: "succeeded" | "failed";
          error?: string | null;
          attempted_at?: string;
        };
        Update: {
          id?: string;
          notification_id?: string;
          store_id?: string;
          channel?: "in_app" | "email";
          attempt_no?: number;
          outcome?: "succeeded" | "failed";
          error?: string | null;
          attempted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey";
            columns: ["notification_id"];
            isOneToOne: false;
            referencedRelation: "platform_notifications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_deliveries_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      notification_preferences: {
        Row: {
          store_id: string;
          type: string;
          channel: "in_app" | "email";
          enabled: boolean;
        };
        Insert: {
          store_id: string;
          type: string;
          channel: "in_app" | "email";
          enabled?: boolean;
        };
        Update: {
          store_id?: string;
          type?: string;
          channel?: "in_app" | "email";
          enabled?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "notification_preferences_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      impersonation_sessions: {
        Row: {
          id: string;
          super_admin_id: string;
          store_id: string;
          started_at: string;
          expires_at: string;
          ended_at: string | null;
          end_reason: "manual" | "expired" | null;
        };
        Insert: {
          id?: string;
          super_admin_id: string;
          store_id: string;
          started_at?: string;
          expires_at: string;
          ended_at?: string | null;
          end_reason?: "manual" | "expired" | null;
        };
        Update: {
          id?: string;
          super_admin_id?: string;
          store_id?: string;
          started_at?: string;
          expires_at?: string;
          ended_at?: string | null;
          end_reason?: "manual" | "expired" | null;
        };
        Relationships: [
          {
            foreignKeyName: "impersonation_sessions_super_admin_id_fkey";
            columns: ["super_admin_id"];
            isOneToOne: false;
            referencedRelation: "platform_admins";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "impersonation_sessions_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      store_offboarding: {
        Row: {
          store_id: string;
          initiated_at: string;
          retention_ends_at: string;
          status_before: string;
          purged: boolean;
          purged_at: string | null;
          restored_at: string | null;
          teardown_recorded: boolean;
          teardown_at: string | null;
        };
        Insert: {
          store_id: string;
          initiated_at?: string;
          retention_ends_at: string;
          status_before: string;
          purged?: boolean;
          purged_at?: string | null;
          restored_at?: string | null;
          teardown_recorded?: boolean;
          teardown_at?: string | null;
        };
        Update: {
          store_id?: string;
          initiated_at?: string;
          retention_ends_at?: string;
          status_before?: string;
          purged?: boolean;
          purged_at?: string | null;
          restored_at?: string | null;
          teardown_recorded?: boolean;
          teardown_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "store_offboarding_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: true;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

/**
 * Row-type helper for Control_Plane tables.
 *
 * @example
 *   type StoreRow = ControlPlaneTables<"stores">;
 */
export type ControlPlaneTables<
  T extends keyof ControlPlaneDatabase["public"]["Tables"]
> = ControlPlaneDatabase["public"]["Tables"][T]["Row"];
