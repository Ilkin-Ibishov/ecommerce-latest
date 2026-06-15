/**
 * Platform auth context — manages super admin session state.
 * Wraps /platform/* routes and redirects to /platform/login if unauthenticated.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getControlPlaneClient } from "./client";

interface PlatformAuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const PlatformAuthContext = createContext<PlatformAuthState>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function usePlatformAuth() {
  return useContext(PlatformAuthContext);
}

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getControlPlaneClient();

    // Get initial session
    client.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    const client = getControlPlaneClient();
    await client.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <PlatformAuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </PlatformAuthContext.Provider>
  );
}
