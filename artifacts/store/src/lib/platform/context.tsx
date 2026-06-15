/**
 * Platform auth context — manages super admin session state.
 * Wraps /platform/* routes and redirects to /platform/login if unauthenticated.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getControlPlaneClient } from "./client";
import { platformFetch } from "./fetch";

interface PlatformAuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** Whether the server-side control_plane_session is confirmed active */
  serverSessionReady: boolean;
  signOut: () => Promise<void>;
}

const PlatformAuthContext = createContext<PlatformAuthState>({
  user: null,
  session: null,
  loading: true,
  serverSessionReady: false,
  signOut: async () => {},
});

export function usePlatformAuth() {
  return useContext(PlatformAuthContext);
}

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverSessionReady, setServerSessionReady] = useState(false);

  useEffect(() => {
    const client = getControlPlaneClient();

    // Get initial session
    client.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);

      // If we have a Supabase session, ensure server-side session exists
      if (s?.access_token) {
        try {
          const res = await platformFetch("/platform/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          // 200 = new session created, or we could get 403 if already has active session
          // Either way, if user is in platform_admins, proceed
          if (res.ok) {
            setServerSessionReady(true);
          } else {
            // Check if the user already has a valid session by probing a platform endpoint
            const probe = await platformFetch("/platform/stores?page=1&pageSize=1");
            if (probe.ok || probe.status !== 403) {
              setServerSessionReady(true);
            }
            // If 403, server session is not valid — user stays on login
          }
        } catch {
          // Network error — assume not ready
        }
      }

      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s) {
        setServerSessionReady(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    // End server-side session
    try {
      await platformFetch("/platform/auth/session", { method: "DELETE" });
    } catch {
      // Best effort
    }
    const client = getControlPlaneClient();
    await client.auth.signOut();
    setUser(null);
    setSession(null);
    setServerSessionReady(false);
  };

  return (
    <PlatformAuthContext.Provider value={{ user, session, loading, serverSessionReady, signOut }}>
      {children}
    </PlatformAuthContext.Provider>
  );
}
