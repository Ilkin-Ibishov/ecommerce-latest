import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { X, Minus, Plus, ShoppingBag, Trash2, Truck, Tag, ChevronDown, CheckCircle } from "lucide-react";
import { useCart } from "@/lib/cart/context";
import { apiUrl } from "@/lib/api";

const FREE_DELIVERY_THRESHOLD = 100;
const PROMO_STORAGE_KEY = "ilk_promo";

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  locale: string;
}

export default function CartDrawer({ open, onClose, locale }: CartDrawerProps) {
  const { items, subtotal, updateQty, removeItem, itemCount } = useCart();
  const drawerRef = useRef<HTMLDivElement>(null);

  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [promo, setPromo] = useState<{ code: string; discount_amount: number; description?: string } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PROMO_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setPromo(parsed);
        setPromoCode(parsed.code);
        setPromoOpen(true);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const deliveryProgress = Math.min(100, (subtotal / FREE_DELIVERY_THRESHOLD) * 100);
  const remaining = Math.max(0, FREE_DELIVERY_THRESHOLD - subtotal);
  const freeDelivery = subtotal >= FREE_DELIVERY_THRESHOLD;
  const discountAmount = promo?.discount_amount ?? 0;
  const total = Math.max(0, subtotal - discountAmount);

  const applyPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoError(""); setPromoLoading(true);
    try {
      const res = await fetch(apiUrl("/coupons/validate"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoCode.trim(), subtotal }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPromoError(data.error ?? "Yanlış promo kod");
        setPromo(null);
        localStorage.removeItem(PROMO_STORAGE_KEY);
      } else {
        const applied = { code: promoCode.trim(), discount_amount: data.discount_amount, description: data.description };
        setPromo(applied);
        localStorage.setItem(PROMO_STORAGE_KEY, JSON.stringify(applied));
        setPromoError("");
      }
    } catch { setPromoError("Yoxlamaq mümkün olmadı. Yenidən cəhd edin."); }
    finally { setPromoLoading(false); }
  };

  const clearPromo = () => {
    setPromo(null);
    setPromoCode("");
    setPromoError("");
    localStorage.removeItem(PROMO_STORAGE_KEY);
  };

  const checkoutHref = `/${locale}/checkout${promo ? `?promo=${encodeURIComponent(promo.code)}` : ""}`;

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      )}
      <div
        ref={drawerRef}
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-md bg-background shadow-2xl flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <ShoppingBag size={20} />
            Səbət
            {itemCount > 0 && (
              <span className="text-sm bg-primary text-primary-foreground rounded-full px-2 py-0.5 font-medium">{itemCount}</span>
            )}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-accent transition">
            <X size={20} />
          </button>
        </div>

        {/* Free delivery progress bar */}
        {items.length > 0 && (
          <div className="px-5 py-3 bg-muted/40 border-b border-border">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="flex items-center gap-1 font-medium">
                <Truck size={13} className={freeDelivery ? "text-green-600" : "text-muted-foreground"} />
                {freeDelivery
                  ? <span className="text-green-600 font-semibold">Pulsuz çatdırılma qazandınız! 🎉</span>
                  : <span><strong>{remaining.toFixed(2)} AZN</strong> daha əlavə edin — Pulsuz Çatdırılma</span>
                }
              </span>
              <span className="text-muted-foreground">{FREE_DELIVERY_THRESHOLD} AZN</span>
            </div>
            <div className="w-full bg-border rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${freeDelivery ? "bg-green-500" : "bg-primary"}`}
                style={{ width: `${deliveryProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <ShoppingBag size={48} className="text-muted-foreground/30" />
              <p className="text-muted-foreground">Səbətiniz boşdur</p>
              <button onClick={onClose} className="text-sm text-primary hover:underline">Alış-verişə davam edin</button>
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.product_id} className="flex gap-3 p-3 rounded-xl border border-border">
                  <Link href={`/${locale}/products/${item.slug}`} onClick={onClose}
                    className="w-16 h-16 rounded-lg overflow-hidden bg-muted shrink-0 block">
                    {item.image ? (
                      <img src={item.image} alt={item.title} className="object-cover w-full h-full" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">?</div>
                    )}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link href={`/${locale}/products/${item.slug}`} onClick={onClose}
                      className="text-sm font-medium line-clamp-2 hover:text-primary transition block">
                      {item.title}
                    </Link>
                    <p className="text-primary font-bold text-sm mt-1">{item.price.toFixed(2)} AZN</p>
                    <div className="flex items-center gap-1 mt-2 border border-border rounded-lg w-fit">
                      <button onClick={() => updateQty(item.product_id, item.quantity - 1)}
                        className="w-7 h-7 flex items-center justify-center hover:bg-accent transition rounded-l-lg text-muted-foreground">
                        <Minus size={12} />
                      </button>
                      <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                      <button onClick={() => updateQty(item.product_id, item.quantity + 1)}
                        className="w-7 h-7 flex items-center justify-center hover:bg-accent transition rounded-r-lg text-muted-foreground">
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end justify-between shrink-0">
                    <button onClick={() => removeItem(item.product_id)}
                      className="text-muted-foreground hover:text-destructive transition p-1">
                      <Trash2 size={14} />
                    </button>
                    <p className="text-sm font-bold">{(item.price * item.quantity).toFixed(2)} AZN</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-border">
            {/* Promo code section */}
            <div className="px-5 pt-3 pb-2 border-b border-border/60">
              <button
                onClick={() => setPromoOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition w-full"
              >
                <Tag size={12} />
                <span className="flex-1 text-left">
                  {promo ? (
                    <span className="text-green-600 font-medium flex items-center gap-1">
                      <CheckCircle size={12} /> Promo tətbiq edilib: <strong>{promo.code}</strong>
                    </span>
                  ) : "Promo kodunuz var?"}
                </span>
                <ChevronDown size={12} className={`transition-transform duration-200 ${promoOpen ? "rotate-180" : ""}`} />
              </button>

              {promoOpen && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoError(""); }}
                      onKeyDown={(e) => e.key === "Enter" && applyPromo()}
                      placeholder="KOD DAXİL EDİN"
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring uppercase tracking-wider"
                    />
                    {promo ? (
                      <button
                        onClick={clearPromo}
                        className="px-3 py-1.5 rounded-lg bg-muted text-xs font-medium hover:bg-destructive/10 hover:text-destructive transition"
                      >
                        Sil
                      </button>
                    ) : (
                      <button
                        onClick={applyPromo}
                        disabled={promoLoading || !promoCode.trim()}
                        className="px-3 py-1.5 rounded-lg bg-secondary text-xs font-medium hover:bg-secondary/80 transition disabled:opacity-50"
                      >
                        {promoLoading ? "…" : "Tətbiq et"}
                      </button>
                    )}
                  </div>
                  {promoError && <p className="text-destructive text-[11px]">{promoError}</p>}
                  {promo && (
                    <p className="text-green-600 text-[11px] font-medium">
                      ✓ -{promo.discount_amount.toFixed(2)} AZN endirim tətbiq edildi
                      {promo.description ? ` — ${promo.description}` : ""}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Totals + checkout */}
            <div className="px-5 py-4 space-y-3">
              {promo ? (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Ara cəm</span>
                    <span>{subtotal.toFixed(2)} AZN</span>
                  </div>
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>Endirim ({promo.code})</span>
                    <span>-{discountAmount.toFixed(2)} AZN</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t border-border pt-2">
                    <span>Cəmi</span>
                    <span className="text-primary">{total.toFixed(2)} AZN</span>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between font-bold text-lg">
                  <span>Cəmi</span>
                  <span className="text-primary">{subtotal.toFixed(2)} AZN</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Truck size={12} />
                Çatdırılma: {freeDelivery ? <span className="text-green-600 font-medium">Pulsuz</span> : "Sifarişdə göstəriləcək"}
              </p>
              <Link href={checkoutHref} onClick={onClose}
                className="block w-full text-center bg-primary text-primary-foreground font-semibold py-3 rounded-xl hover:bg-primary/90 transition">
                Sifariş ver{promo ? ` · ${total.toFixed(2)} AZN` : ""}
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
