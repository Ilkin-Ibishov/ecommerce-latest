import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface AdminRoleState {
  role: "admin" | "staff" | "customer" | null;
  isAdmin: boolean;
  isStaff: boolean;
  loading: boolean;
}

export function useAdminRole(): AdminRoleState {
  const [role, setRole] = useState<"admin" | "staff" | "customer" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    async function loadRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (isMounted) {
            setRole(null);
            setLoading(false);
          }
          return;
        }

        const { data } = await supabase
          .from("users")
          .select("role")
          .eq("id", user.id)
          .single();

        if (isMounted) {
          setRole((data?.role as "admin" | "staff" | "customer") ?? null);
          setLoading(false);
        }
      } catch {
        if (isMounted) {
          setRole(null);
          setLoading(false);
        }
      }
    }

    loadRole();

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    role,
    isAdmin: role === "admin",
    isStaff: role === "staff",
    loading,
  };
}
