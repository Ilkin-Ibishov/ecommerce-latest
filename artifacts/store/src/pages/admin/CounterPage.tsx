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
import { addQuantity, computeChange } from "@/components/admin/counter/counter-input";
import { useCounterSale } from "@/components/admin/counter/useCounterSale";
import { useI18n } from "@/lib/i18n/context";

// The till (M3a). The cart lives here until Complete; posting the sale, its retry and outcome
// live in useCounterSale.
export default function CounterPage() {
  const { t } = useI18n();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [bundles, setBundles] = useState<CounterBundle[]>([]);
  const [picker, setPicker] = useState<LookupItem[] | null>(null);
  // A scan still in flight holds Complete. The onResults guard below reads the state of the
  // render the scan was sent from, so it cannot drop a late result: one landing after Complete
  // went into the already-sent cart and was cleared with it on success.
  const [lookupBusy, setLookupBusy] = useState(false);
  const [payment, setPayment] = useState<"cash" | "card" | "other">("cash");
  const [ownerDiscount, setOwnerDiscount] = useState("");
  const [tenderedAmount, setTenderedAmount] = useState("");
  const [isOwner, setIsOwner] = useState(false);

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

  const {
    saleId, pending, outcome, setOutcome, showConfirm, setShowConfirm, completedReceipt, setCompletedReceipt,
    canDiscard, complete, handleOpenConfirm, discardAttempt,
  } = useCounterSale({
    lines, displayedTotal: priced.total_amount, payment, isOwner, ownerDiscount, tenderedAmount,
    onPosted: () => {
      setLines([]);
      setOwnerDiscount("");
      setTenderedAmount("");
    },
  });

  const addItem = (item: LookupItem) => {
    if (pending || showConfirm) return;
    setPicker(null);
    setOutcome(null);
    setLines((cur) => {
      const existing = cur.find((l) => l.variant_id === item.variant_id && !l.bundle_id);
      if (existing) return cur.map((l) => (l === existing ? { ...l, quantity: addQuantity(l.quantity, item.pack_quantity) } : l));
      return [...cur, {
        key: crypto.randomUUID(), variant_id: item.variant_id, title: item.title, options: optionLabel(item.options),
        quantity: addQuantity(0, item.pack_quantity), unit_price: item.price, on_hand: item.on_hand, available: item.available,
        reservations: item.reservations, bundle_id: null,
      }];
    });
  };

  const addBundle = (b: CounterBundle) => setLines((cur) => [...cur, ...b.lines.map((l) => ({
    key: crypto.randomUUID(), variant_id: l.variant_id, title: l.title, options: "", quantity: l.quantity,
    unit_price: l.price, on_hand: l.on_hand, available: l.track_stock === false ? null : l.on_hand, reservations: [], bundle_id: b.id,
  }))]);

  const { sufficient, change: changeAmount } = computeChange(tenderedAmount, priced.total_amount);
  const hasValidCashTender = payment !== "cash" || sufficient;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("Admin.Counter.title")}</h1>
          {pending
            ? <span className="text-sm text-muted-foreground">{t("Admin.Counter.salesLink")}</span>
            : <Link href="/admin/counter/sales" className="text-sm text-primary underline">{t("Admin.Counter.salesLink")}</Link>}
        </div>
        <LookupBox
          disabled={pending || !!picker || showConfirm || !!completedReceipt}
          resetSignal={saleId}
          onBusyChange={setLookupBusy}
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
          lookupBusy={lookupBusy}
          onCompleteClick={handleOpenConfirm}
          onViewReceipt={(id) => setCompletedReceipt({ id })}
          onDiscard={discardAttempt}
          canDiscard={canDiscard}
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
