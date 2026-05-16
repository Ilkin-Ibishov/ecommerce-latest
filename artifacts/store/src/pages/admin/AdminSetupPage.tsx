import { useState } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

export default function AdminSetupPage() {
  const [, navigate] = useLocation();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch(apiUrl("/bootstrap/admin"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), name: name.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong.");
        return;
      }

      setStatus("done");
      setMessage(data.message ?? "Admin account created!");
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message ?? "Network error.");
    }
  };

  const handleSignIn = async () => {
    // Trigger OTP flow — navigate to store home so they can sign in normally
    const supabase = createClient();
    await supabase.auth.signOut();
    navigate("/az");
    window.dispatchEvent(new CustomEvent("open-login-modal"));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-2xl p-8 shadow-lg space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-2">
              <ShieldCheck size={28} className="text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Create Admin Account</h1>
            <p className="text-sm text-muted-foreground">
              First-time setup — this page is disabled once an admin exists.
            </p>
          </div>

          {status === "done" ? (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-sm text-green-400">
                {message}
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Now sign in with your phone number using OTP to access the admin panel.
              </p>
              <button
                onClick={handleSignIn}
                className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition"
              >
                Sign In Now
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">
                  Phone Number <span className="text-red-400">*</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+994501234567"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground mt-1">Include country code, e.g. +994…</p>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">
                  Your Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Admin"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {status === "error" && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-400">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={status === "loading" || !phone.trim()}
                className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {status === "loading" ? (
                  <><Loader2 size={16} className="animate-spin" /> Creating Account…</>
                ) : (
                  "Create Admin Account"
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
