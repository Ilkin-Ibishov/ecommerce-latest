import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { priceCounterSale } from "@workspace/counter-pricing";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { createClient } from "@/lib/supabase/client";
import { LookupBox } from "@/components/admin/counter/LookupBox";
import { VariantPicker } from "@/components/admin/counter/VariantPicker";
import { CartLines } from "@/components/admin/counter/CartLines";
import { PickupPanel } from "@/components/admin/counter/PickupPanel";
import { CounterCheckoutPanel } from "@/components/admin/counter/CounterCheckoutPanel";
import { PaymentConfirmationModal } from "@/components/admin/counter/PaymentConfirmationModal";
import { ReceiptModal } from "@/components/admin/counter/ReceiptModal";
import { optionLabel, type CartLine, type CounterBundle, type LookupItem, type Outcome } from "@/components/admin/counter/types";
import { computeChange } from "@/components/admin/counter/counter-input";
import { useI18n } from "@/lib/i18n/context";

// The till (M3a). The cart lives here until Complete; after Complete it is frozen until the
// outcome is known, and a retry resends the same id (design note Q2, audit A10.2).
export default function CounterPage() {
  const { t } = useI18n();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [bundles, setBundles] = useState<CounterBundle[]>([]);
  const [picker, setPicker] = useState<LookupItem[] | null>(null);
  const [payment, setPayment] = useState<"cash" | "card" | "other">("cash");
  const [ownerDiscount, setOwnerDiscount] = useState("");
  const [tenderedAmount, setTenderedAmount] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [saleId, setSaleId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false); // Complete sent, outcome unknown
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [completedReceipt, setCompletedReceipt] = useState<{ id: string; tendered?: number | null; change?: number | null } | null>(null);
  const soldAtRef = useRef<string | null>(null);

  useEffect(() => {
    adminFetch(apiUrl("/admin/counter/bundles")).then((r) => (r.ok ? r.json() : [])).then(setBundles).catch(() => {});
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("users").select("role").eq("id", user.id).single();
      setIsOwner(data?.role === "admin");
    });
  }, []);

  useEffect(() => {
    if (!pending) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [pending]);

  const priced = useMemo(() => priceCounterSale(
    lines.map((l, i) => ({ line_no: i + 1, variant_id: l.variant_id, quantity: l.quantity, charged_unit_price: l.unit_price, bundle_id: l.bundle_id })),
    bundles.map((b) => ({ id: b.id, bundle_price: b.bundle_price, lines: b.lines })),
    isOwner ? Number(ownerDiscount) || 0 : 0,
  ), [lines, bundles, ownerDiscount, isOwner]);

  const addItem = (item: LookupItem) => {
    if (pending || showConfirm) return;
    setPicker(null);
    setOutcome(null);
    setLines((cur) => {
      const existing = cur.find((l) => l.variant_id === item.variant_id && !l.bundle_id);
      if (existing) return cur.map((l) => (l === existing ? { ...l, quantity: l.quantity + item.pack_quantity } : l));
      return [...cur, {
        key: crypto.randomUUID(), variant_id: item.variant_id, title: item.title, options: optionLabel(item.options),
        quantity: item.pack_quantity, unit_price: item.price, on_hand: item.on_hand, available: item.available,
        reservations: item.reservations, bundle_id: null,
      }];
    });
  };

  const addBundle = (b: CounterBundle) => setLines((cur) => [...cur, ...b.lines.map((l) => ({
    key: crypto.randomUUID(), variant_id: l.variant_id, title: l.title, options: "", quantity: l.quantity,
    unit_price: l.price, on_hand: l.on_hand, available: l.track_stock === false ? null : l.on_hand, reservations: [], bundle_id: b.id,
  }))]);

  const complete = async () => {
    setPending(true);
    setOutcome(null);
    try {
      const res = await adminFetch(apiUrl("/admin/counter/sales"), {
        method: "POST",
        body: JSON.stringify({
          id: saleId, sold_at: (soldAtRef.current ??= new Date().toISOString()), payment_method: payment,
          owner_discount: isOwner ? Number(ownerDiscount) || 0 : 0, displayed_total: priced.total_amount,
          lines: lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, charged_unit_price: l.unit_price, bundle_id: l.bundle_id })),
        }),
      });
      const data = (await res.json().catch(() => null)) ?? {};
      if (!res.ok) {
        if (res.status >= 500) {
          console.error(data.error);
          setFailedAttempts((n) => n + 1);
          setShowConfirm(false);
          setOutcome({ kind: "error", text: t("Admin.Counter.networkError") });
          return;
        }
        if (data.code === "ST020") {
          setShowConfirm(false);
          setOutcome({ kind: "error", text: t("Admin.Counter.alreadyRecorded") });
          setSaleId(crypto.randomUUID());
          soldAtRef.current = null;
          setPending(false);
          setFailedAttempts(0);
          return;
        }
        soldAtRef.current = null;
        setPending(false);
        setShowConfirm(false);
        setOutcome({ kind: "error", text: data.error ?? t("Admin.Counter.errorFallback") });
        return;
      }
      if (!data.sale_number || !data.id) {
        setShowConfirm(false);
        setOutcome({ kind: "error", text: t("Admin.Counter.networkError") });
        setFailedAttempts((n) => n + 1);
        return;
      }
      const serverTotal = Number(data.total_amount);
      const { change: serverChange } = computeChange(tenderedAmount, serverTotal);
      const tNum = parseFloat(tenderedAmount);
      const finalTendered = payment === "cash" && !isNaN(tNum) ? tNum : null;
      const finalChange = finalTendered !== null && serverTotal === priced.total_amount ? serverChange : null;

      setShowConfirm(false);
      setOutcome(data.status === "needs_owner"
        ? { kind: "needs_owner", text: t("Admin.Counter.saleNeedsOwner").replace("{saleNumber}", String(data.sale_number)), saleId: data.id }
        : { kind: "posted", text: t("Admin.Counter.salePosted").replace("{saleNumber}", String(data.sale_number)), saleId: data.id });
      setCompletedReceipt({ id: data.id, tendered: finalTendered, change: finalChange });
      setLines([]);
      setOwnerDiscount("");
      setTenderedAmount("");
      setSaleId(crypto.randomUUID());
      soldAtRef.current = null;
      setPending(false);
      setFailedAttempts(0);
    } catch {
      setFailedAttempts((n) => n + 1);
      setShowConfirm(false);
      setOutcome({ kind: "error", text: t("Admin.Counter.networkError") });
    }
  };

  const handleOpenConfirm = () => {
    if (pending && outcome?.kind === "error") {
      void complete();
      return;
    }
    setShowConfirm(true);
  };

  const discardAttempt = () => {
    setSaleId(crypto.randomUUID());
    soldAtRef.current = null;
    setPending(false);
    setShowConfirm(false);
    setFailedAttempts(0);
    setOutcome({ kind: "error", text: t("Admin.Counter.discardedCheckSales") });
  };

  const { sufficient, change: changeAmount } = computeChange(tenderedAmount, priced.total_amount);
  const hasValidCashTender = payment !== "cash" || sufficient;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("Admin.Counter.title")}</h1>
          <Link href="/admin/counter/sales" className="text-sm text-primary underline">{t("Admin.Counter.salesLink")}</Link>
        </div>
        <LookupBox
          disabled={pending || !!picker || showConfirm || !!completedReceipt}
          resetSignal={saleId}
          onResults={(items) => {
            if (pending || showConfirm) return;
            items.length === 1 ? addItem(items[0]) : setPicker(items);
          }}
        />
        {bundles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {bundles.map((b) => (
              <button key={b.id} type="button" disabled={pending} onClick={() => addBundle(b)}
                className="rounded-full border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50">
                + {b.name}{b.bundle_price !== null && ` (${b.bundle_price.toFixed(2)} AZN)`}{b.available !== undefined && ` · ${b.available === null ? "—" : t("Admin.Counter.bundleAvailable").replace("{n}", String(b.available))}`}
              </button>
            ))}
          </div>
        )}
        <CartLines lines={lines} nets={priced.lines.map((l: { net_line_total: number }) => l.net_line_total)} locked={pending}
          onQuantity={(key, q) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, quantity: q } : l)))}
          onRemove={(key) => setLines((cur) => cur.filter((l) => l.key !== key))} />
      </div>

      <aside className="space-y-4">
        <CounterCheckoutPanel
          priced={priced}
          isOwner={isOwner}
          ownerDiscount={ownerDiscount}
          onOwnerDiscountChange={setOwnerDiscount}
          payment={payment}
          onPaymentChange={setPayment}
          tenderedAmount={tenderedAmount}
          onTenderedAmountChange={setTenderedAmount}
          hasValidCashTender={hasValidCashTender}
          changeAmount={changeAmount}
          pending={pending}
          outcome={outcome}
          hasLines={lines.length > 0}
          onCompleteClick={handleOpenConfirm}
          onViewReceipt={(id) => setCompletedReceipt({ id })}
          onDiscard={discardAttempt}
          canDiscard={pending && outcome?.kind === "error" && failedAttempts >= 3}
        />
        <PickupPanel />
      </aside>

      {picker && <VariantPicker items={picker} onPick={addItem} onClose={() => setPicker(null)} />}

      <PaymentConfirmationModal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={() => void complete()}
        totalAmount={priced.total_amount}
        paymentMethod={payment}
        onPaymentMethodChange={setPayment}
        tenderedAmount={tenderedAmount}
        onTenderedAmountChange={setTenderedAmount}
        pending={pending}
      />

      <ReceiptModal
        saleId={completedReceipt?.id ?? null}
        tendered={completedReceipt?.tendered}
        change={completedReceipt?.change}
        onClose={() => setCompletedReceipt(null)}
      />
    </div>
  );
}
