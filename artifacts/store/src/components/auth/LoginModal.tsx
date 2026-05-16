import { useState } from "react";
import { X, Phone, ArrowRight, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type Step = "phone" | "otp" | "name" | "success";

export function LoginModal({ open, onClose, onSuccess }: LoginModalProps) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const supabase = createClient();

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.startsWith("994")) return `+${digits}`;
    if (digits.startsWith("0")) return `+994${digits.slice(1)}`;
    if (digits.length > 0 && !digits.startsWith("9")) return `+994${digits}`;
    return digits ? `+${digits}` : "";
  };

  const startCooldown = () => {
    setCooldown(60);
    const interval = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(interval); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const formatted = formatPhone(phone);
    if (!/^\+994\d{9}$/.test(formatted)) {
      setError("Please enter a valid Azerbaijan phone number (+994XXXXXXXXX)");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/auth/otp/request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: formatted }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.reason === "cooldown") setError("Please wait 60 seconds before requesting a new code.");
        else if (data.reason === "rate_limit_hour") setError("Too many requests. Please try again in an hour.");
        else setError(data.error ?? "Failed to send OTP. Please try again.");
        return;
      }
      setStep("otp");
      startCooldown();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (otp.length !== 6) { setError("Please enter the 6-digit code."); return; }
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/auth/otp/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: formatPhone(phone), code: otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.reason === "invalid_code") setError("Incorrect code. Please try again.");
        else if (data.reason === "max_attempts") { setError("Too many failed attempts. Please request a new code."); setStep("phone"); }
        else if (data.reason === "not_found_or_expired") { setError("Code expired. Please request a new one."); setStep("phone"); }
        else setError(data.error ?? "Verification failed.");
        return;
      }
      if (data.access_token) {
        await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
      }
      if (data.isNew) {
        setStep("name");
      } else {
        setStep("success");
        setTimeout(() => { onSuccess?.(); handleClose(); }, 1500);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await (supabase as any).from("users").update({ full_name: fullName.trim() }).eq("id", user.id);
      }
      setStep("success");
      setTimeout(() => { onSuccess?.(); handleClose(); }, 1200);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep("phone"); setPhone(""); setOtp(""); setFullName(""); setError("");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-background rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 border border-border">
        <button onClick={handleClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-accent transition">
          <X size={18} />
        </button>

        {step === "phone" && (
          <div>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
              <Phone size={22} className="text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-1">Sign in with WhatsApp</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Enter your phone number. We'll send a verification code via WhatsApp.
            </p>
            {import.meta.env.DEV && (
              <p className="text-xs text-orange-600 mb-3 bg-orange-50 px-3 py-2 rounded-lg">
                DEV MODE: OTP code will be logged to the server console.
              </p>
            )}
            <form onSubmit={handlePhoneSubmit} className="space-y-4">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="+994 XX XXX XX XX"
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                autoFocus />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-3 rounded-xl font-medium hover:bg-primary/90 transition disabled:opacity-50">
                {loading ? "Sending..." : "Send Code"}
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>
          </div>
        )}

        {step === "otp" && (
          <div>
            <h2 className="text-xl font-bold mb-1">Enter verification code</h2>
            <p className="text-sm text-muted-foreground mb-6">
              We sent a 6-digit code to <strong>{phone}</strong> via WhatsApp.
            </p>
            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="------"
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-center text-2xl tracking-widest font-mono"
                autoFocus />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={loading || otp.length !== 6}
                className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-medium hover:bg-primary/90 transition disabled:opacity-50">
                {loading ? "Verifying..." : "Verify Code"}
              </button>
              <div className="text-center">
                {cooldown > 0 ? (
                  <p className="text-xs text-muted-foreground">Resend in {cooldown}s</p>
                ) : (
                  <button type="button" onClick={handlePhoneSubmit as any}
                    className="text-xs text-primary hover:underline flex items-center gap-1 mx-auto">
                    <RotateCcw size={12} /> Resend code
                  </button>
                )}
              </div>
              <button type="button" onClick={() => setStep("phone")}
                className="text-xs text-muted-foreground hover:text-foreground w-full text-center">
                Change phone number
              </button>
            </form>
          </div>
        )}

        {step === "name" && (
          <div>
            <h2 className="text-xl font-bold mb-1">Welcome!</h2>
            <p className="text-sm text-muted-foreground mb-6">What's your name? (optional)</p>
            <form onSubmit={handleNameSubmit} className="space-y-4">
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="w-full px-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                autoFocus />
              <button type="submit" disabled={loading}
                className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-medium hover:bg-primary/90 transition disabled:opacity-50">
                {loading ? "Saving..." : "Continue"}
              </button>
              <button type="button" onClick={() => { setStep("success"); setTimeout(handleClose, 1200); }}
                className="text-xs text-muted-foreground hover:text-foreground w-full text-center">
                Skip
              </button>
            </form>
          </div>
        )}

        {step === "success" && (
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-xl font-bold mb-1">You're in!</h2>
            <p className="text-sm text-muted-foreground">Successfully signed in.</p>
          </div>
        )}
      </div>
    </div>
  );
}
