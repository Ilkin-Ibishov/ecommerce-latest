/**
 * Platform Login Page — super admin sign-in against the Control-Plane Supabase project.
 */
import { useState } from "react";
import { getControlPlaneClient } from "@/lib/platform/client";

export default function PlatformLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const client = getControlPlaneClient();
    const { data, error: authError } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Create a server-side control_plane_session
    const token = data.session?.access_token;
    if (token) {
      try {
        const { platformFetch } = await import("@/lib/platform/fetch");
        const res = await platformFetch("/platform/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Session creation failed" }));
          // If MFA is required, show that error
          setError(body.error ?? `Session failed (${res.status})`);
          setLoading(false);
          return;
        }
      } catch {
        // Non-critical — session may already exist or endpoint may not be deployed yet
      }
    }

    // Auth state change listener in PlatformAuthProvider will pick up the session
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-center mb-2">Platform Control Plane</h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          Sign in with your super admin credentials
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="platform-email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="platform-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label htmlFor="platform-password" className="block text-sm font-medium mb-1">
              Password
            </label>
            <input
              id="platform-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-destructive text-xs">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
