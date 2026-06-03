import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";

export interface UserProfile {
  full_name: string | null;
  phone: string | null;
  default_address: string | null;
}

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setProfile(null); setLoading(false); return; }
      const res = await fetch(apiUrl("/profile"), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) setProfile(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProfile();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_: any, session: any) => {
      if (session) fetchProfile();
      else { setProfile(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const updateProfile = useCallback(async (updates: Partial<Pick<UserProfile, "full_name" | "default_address">>) => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return false;
      const res = await fetch(apiUrl("/profile"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const updated = await res.json();
        setProfile(updated);
        return true;
      }
    } catch {}
    finally { setSaving(false); }
    return false;
  }, []);

  return { profile, loading, saving, updateProfile, refetch: fetchProfile };
}
