import { useEffect, useMemo, useState } from "react";
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
import { optionLabel, type CartLine, type CounterBundle, type LookupItem } from "@/components/admin/counter/types";

type Outcome = { kind: "posted" | "needs_owner" | "error"; text: string; saleId?: string };

// The till (M3a). The cart lives here until Complete; after Complete it is frozen until the
// outcome is known, and a retry resends the same id (design note Q2, audit A10.2).
export default function CounterPage() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [bundles, setBundles] = useState<CounterBundle[]>([]);
  const [picker, setPicker] = useState<LookupItem[] | null>(null);
  const [payment, setPayment] = useState<"cash" | "card" | "other">("cash");
  const [ownerDiscount, setOwnerDiscount] = useState("");
  const [tenderedAmount, setTenderedAmount] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [saleId, setSaleId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false); // Complete sent, outcome unknown
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [completedReceipt, setCompletedReceipt] = useState<{ id: string; tendered?: number | null; change?: number | null } | null>(null);

  useEffect(() => {
    adminFetch(apiUrl("/admin/counter/bundles")).then((r) => (r.ok ? r.json() : [])).then(setBundles).catch(() => {});
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("users").select("role").eq("id", user.id).single();
      setIsOwner(data?.role === "admin");
    });
  }, []);

  const priced = useMemo(() => priceCounterSale(
    lines.map((l, i) => ({ line_no: i + 1, variant_id: l.variant_id, quantity: l.quantity, charged_unit_price: l.unit_price, bundle_id: l.bundle_id })),
    bundles.map((b) => ({ id: b.id, bundle_price: b.bundle_price, lines: b.lines })),
    isOwner ? Number(ownerDiscount) || 0 : 0,
  ), [lines, bundles, ownerDiscount, isOwner]);

  const addItem = (item: LookupItem) => {
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
    unit_price: l.price, on_hand: l.on_hand, available: l.on_hand, reservations: [], bundle_id: b.id,
  }))]);

  const complete = async () => {
    setPending(true);
    setOutcome(null);
    try {
      const res = await adminFetch(apiUrl("/admin/counter/sales"), {
        method: "POST",
        body: JSON.stringify({
          id: saleId, sold_at: new Date().toISOString(), payment_method: payment,
          owner_discount: isOwner ? Number(ownerDiscount) || 0 : 0, displayed_total: priced.total_amount,
          lines: lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity, charged_unit_price: l.unit_price, bundle_id: l.bundle_id })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPending(false);
        setShowConfirm(false);
        setOutcome({ kind: "error", text: data.error ?? "Xəta" });
        return;
      }
      const tNum = parseFloat(tenderedAmount);
      const finalTendered = payment === "cash" && !isNaN(tNum) ? tNum : null;
      const finalChange = finalTendered !== null ? Math.max(0, finalTendered - priced.total_amount) : null;

      setShowConfirm(false);
      setOutcome(data.status === "needs_owner"
        ? { kind: "needs_owner", text: `Satış #${data.sale_number} qeyd olundu. Stok sistemdə azdır: sahibkar yoxlamalıdır.`, saleId: data.id }
        : { kind: "posted", text: `Satış #${data.sale_number} tamamlandı.`, saleId: data.id });
      setCompletedReceipt({ id: data.id, tendered: finalTendered, change: finalChange });
      setLines([]);
      setOwnerDiscount("");
      setTenderedAmount("");
      setSaleId(crypto.randomUUID());
      setPending(false);
    } catch {
      setPending(false);
      setShowConfirm(false);
      setOutcome({ kind: "error", text: "Bağlantı xətası. Nəticə məlum deyil: yenidən göndərin." });
    }
  };

  const handleOpenConfirm = () => {
    if (pending && outcome?.kind === "error") {
      void complete();
      return;
    }
    setShowConfirm(true);
  };

  const tenderedNum = parseFloat(tenderedAmount);
  const hasValidCashTender = payment !== "cash" || (!isNaN(tenderedNum) && tenderedNum >= priced.total_amount);
  const changeAmount = !isNaN(tenderedNum) && tenderedNum >= priced.total_amount ? tenderedNum - priced.total_amount : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Kassa</h1>
          <Link href="/admin/counter/sales" className="text-sm text-primary underline">Satışlar</Link>
        </div>
        <LookupBox disabled={pending || !!picker} resetSignal={saleId} onResults={(items) => (items.length === 1 ? addItem(items[0]) : setPicker(items))} />
        {bundles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {bundles.map((b) => (
              <button key={b.id} type="button" disabled={pending} onClick={() => addBundle(b)}
                className="rounded-full border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50">
                + {b.name}{b.bundle_price !== null && ` (${b.bundle_price.toFixed(2)} AZN)`}{b.available !== undefined && ` · ${b.available === null ? "—" : `${b.available} mövcud`}`}
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
