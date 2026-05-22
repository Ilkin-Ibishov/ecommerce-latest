import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Trash2, Tag, CheckCircle, ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart/context";
import { createClient } from "@/lib/supabase/client";
import { LoginModal } from "@/components/auth/LoginModal";
import { apiUrl } from "@/lib/api";

const PROMO_STORAGE_KEY = "ilk_promo";

export default function CheckoutPage({ locale }: { locale: string }) {
  const { items, subtotal, removeItem, clearCart } = useCart();
  const supabase = createClient();

  const [user, setUser] = useState<any>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [error, setError] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [coupon, setCoupon] = useState<any>(null);
  const [form, setForm] = useState({ customer_name: "", customer_phone: "", delivery_address: "", notes: "" });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  // Pre-fill promo code from cart drawer (localStorage) or URL query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const promoParam = params.get("promo");

    if (promoParam) {
      setCouponCode(promoParam.toUpperCase());
      return;
    }

    try {
      const saved = localStorage.getItem(PROMO_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.code) {
          setCouponCode(parsed.code);
          setCoupon(parsed);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const discountAmount = coupon?.discount_amount ?? 0;
  const total = Math.max(0, subtotal - discountAmount);

  const applyCoupon = async (code?: string) => {
    const codeToApply = (code ?? couponCode).trim();
    if (!codeToApply) return;
    setCouponError(""); setCouponLoading(true);
    try {
      const res = await fetch(apiUrl("/coupons/validate"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeToApply, subtotal }),
      });
      const data = await res.json();
      if (!res.ok) { setCouponError(data.error ?? "Yanlış kupon kodu"); setCoupon(null); }
      else {
        setCoupon(data);
        setCouponCode(codeToApply);
        localStorage.setItem(PROMO_STORAGE_KEY, JSON.stringify({ code: codeToApply, ...data }));
      }
    } catch { setCouponError("Kupon yoxlanıla bilmədi. Yenidən cəhd edin."); }
    finally { setCouponLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { setShowLogin(true); return; }
    if (items.length === 0) return;
    setError(""); setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setShowLogin(true); setLoading(false); return; }

      const res = await fetch(apiUrl("/orders"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
          ...form,
          coupon_code: coupon ? couponCode : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to place order"); return; }
      setOrderId(data.orderId);
      setPlaced(true);
      clearCart();
      localStorage.removeItem(PROMO_STORAGE_KEY);
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  };

  if (placed) return (
    <div className="container mx-auto px-4 py-16 max-w-lg text-center">
      <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
        <CheckCircle size={40} className="text-green-500" />
      </div>
      <h1 className="text-2xl font-bold mb-2">Sifariş qəbul edildi!</h1>
      <p className="text-muted-foreground mb-2">Təşəkkür edirik, {form.customer_name}. Sifarişiniz qəbul edildi.</p>
      <p className="text-sm text-muted-foreground mb-1">Sifariş ID: <span className="font-mono font-medium">#{orderId.slice(0, 8).toUpperCase()}</span></p>
      <p className="text-sm text-muted-foreground mb-8">
        Kuryer çatdırılmadan əvvəl <strong>{form.customer_phone}</strong> nömrəsinə zəng edəcək.
        Çatdırılmada <strong>{total.toFixed(2)} AZN</strong> nağd ödəyəcəksiniz.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link href={`/${locale}/profile`} className="inline-block bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold hover:bg-primary/90 transition">
          Sifarişi izlə
        </Link>
        <Link href={`/${locale}`} className="inline-block border border-border px-8 py-3 rounded-xl font-semibold hover:bg-accent transition">
          Alış-verişə davam et
        </Link>
      </div>
    </div>
  );

  if (items.length === 0) return (
    <div className="container mx-auto px-4 py-16 text-center">
      <ShoppingBag size={48} className="mx-auto text-muted-foreground/30 mb-4" />
      <p className="text-muted-foreground mb-4">Səbətiniz boşdur.</p>
      <Link href={`/${locale}/products`} className="text-primary hover:underline text-sm">Məhsullara bax</Link>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-2xl font-bold mb-8">Sifariş ver</h1>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h2 className="font-semibold">Məlumatlarınız</h2>
            {!user && (
              <div className="bg-primary/10 text-primary text-sm px-4 py-3 rounded-lg">
                Sifariş vermək üçün{" "}
                <button type="button" onClick={() => setShowLogin(true)} className="underline font-medium">daxil olun</button>.
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Ad Soyad" value={form.customer_name} onChange={(v) => setForm((f) => ({ ...f, customer_name: v }))} placeholder="Adınız" required />
              <Field label="WhatsApp nömrəsi" value={form.customer_phone} onChange={(v) => setForm((f) => ({ ...f, customer_phone: v }))} placeholder="+994 XX XXX XX XX" type="tel" required />
            </div>
            <Field label="Çatdırılma ünvanı" value={form.delivery_address} onChange={(v) => setForm((f) => ({ ...f, delivery_address: v }))} placeholder="Şəhər, küçə, ev nömrəsi" required />
            <div>
              <label className="block text-sm font-medium mb-1">Qeyd (istəyə görə)</label>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Kuryer üçün qeyd…" rows={2}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Tag size={16} />Promo Kod</h2>
            {coupon ? (
              <div className="flex items-center gap-3">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/40 text-green-700 dark:text-green-400 text-sm">
                  <CheckCircle size={14} />
                  <span className="font-medium">{couponCode}</span>
                  <span className="text-xs opacity-80">— -{discountAmount.toFixed(2)} AZN endirim</span>
                </div>
                <button type="button" onClick={() => { setCoupon(null); setCouponCode(""); localStorage.removeItem(PROMO_STORAGE_KEY); }}
                  className="px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50 transition">
                  Sil
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input type="text" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyCoupon())}
                    placeholder="KOD DAXİL EDİN"
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring uppercase tracking-wide" />
                  <button type="button" onClick={() => applyCoupon()} disabled={couponLoading || !couponCode.trim()}
                    className="px-4 py-2 rounded-lg bg-secondary text-sm font-medium hover:bg-secondary/80 transition disabled:opacity-50">
                    {couponLoading ? "…" : "Tətbiq et"}
                  </button>
                </div>
                {couponError && <p className="text-destructive text-xs mt-1">{couponError}</p>}
              </>
            )}
          </div>

          {error && <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg">{error}</div>}

          <button type="submit" disabled={loading}
            className="w-full bg-primary text-primary-foreground font-bold py-4 rounded-xl hover:bg-primary/90 transition disabled:opacity-60 text-lg">
            {loading ? "Sifariş verilir…" : `Sifariş ver · ${total.toFixed(2)} AZN`}
          </button>
          <p className="text-xs text-center text-muted-foreground">Nağd ödəniş · Çatdırılmada AZN ilə ödəyin</p>
        </form>

        <div className="space-y-3">
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="font-semibold mb-4">Sifariş icmalı</h2>
            <ul className="space-y-3 divide-y divide-border">
              {items.map((item) => (
                <li key={item.product_id} className="flex gap-3 pt-3 first:pt-0">
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-muted shrink-0">
                    {item.image ? <img src={item.image} alt={item.title} className="object-cover w-full h-full" />
                      : <div className="w-full h-full bg-muted" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2">{item.title}</p>
                    <p className="text-xs text-muted-foreground">×{item.quantity}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold">{(item.price * item.quantity).toFixed(2)} AZN</p>
                    <button type="button" onClick={() => removeItem(item.product_id)} className="text-muted-foreground hover:text-destructive transition">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-border mt-4 pt-4 space-y-2">
              <div className="flex justify-between text-sm"><span>Ara cəm</span><span>{subtotal.toFixed(2)} AZN</span></div>
              {coupon && <div className="flex justify-between text-sm text-green-600"><span>Endirim</span><span>-{discountAmount.toFixed(2)} AZN</span></div>}
              <div className="flex justify-between text-sm"><span>Çatdırılma</span><span className="text-green-600">Pulsuz</span></div>
              <div className="flex justify-between font-bold text-lg border-t border-border pt-3 mt-1">
                <span>Cəmi</span><span className="text-primary">{total.toFixed(2)} AZN</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)}
        onSuccess={() => supabase.auth.getUser().then(({ data }) => setUser(data.user))} />
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
    </div>
  );
}
