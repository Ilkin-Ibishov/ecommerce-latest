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
  const [isOwner, setIsOwner] = useState(false);
  const [saleId, setSaleId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false); // Complete sent, outcome unknown
  const [outcome, setOutcome] = useState<Outcome | null>(null);

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
        // A rejected request will not succeed on resend: unfreeze so the cashier can fix it.
        setPending(false);
        setOutcome({ kind: "error", text: data.error ?? "Xəta" });
        return;
      }
      setOutcome(data.status === "needs_owner"
        ? { kind: "needs_owner", text: `Satış #${data.sale_number} qeyd olundu. Stok sistemdə azdır: sahibkar yoxlamalıdır.`, saleId: data.id }
        : { kind: "posted", text: `Satış #${data.sale_number} tamamlandı.`, saleId: data.id });
      setLines([]);
      setOwnerDiscount("");
      setSaleId(crypto.randomUUID());
      setPending(false);
    } catch {
      // Unknown outcome (network). Keep the cart frozen; Retry resends the same id.
      setOutcome({ kind: "error", text: "Bağlantı xətası. Nəticə məlum deyil: yenidən göndərin." });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Kassa</h1>
          <Link href="/admin/counter/sales" className="text-sm text-primary underline">Satışlar</Link>
        </div>
        <LookupBox disabled={pending || !!picker} onResults={(items) => (items.length === 1 ? addItem(items[0]) : setPicker(items))} />
        {bundles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {bundles.map((b) => (
              <button key={b.id} type="button" disabled={pending} onClick={() => addBundle(b)}
                className="rounded-full border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50">
                + {b.name}{b.bundle_price !== null && ` (${b.bundle_price.toFixed(2)} AZN)`}
              </button>
            ))}
          </div>
        )}
        <CartLines lines={lines} nets={priced.lines.map((l) => l.net_line_total)} locked={pending}
          onQuantity={(key, q) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, quantity: q } : l)))}
          onRemove={(key) => setLines((cur) => cur.filter((l) => l.key !== key))} />
      </div>

      <aside className="space-y-4">
        <section className="space-y-3 rounded-xl border border-border p-4">
          {priced.bundle_discount > 0 && <p className="flex justify-between text-sm"><span>Dəst endirimi</span><span>−{priced.bundle_discount.toFixed(2)}</span></p>}
          {isOwner && (
            <label className="flex items-center justify-between gap-2 text-sm">
              Endirim (AZN)
              <input type="number" min="0" step="0.01" value={ownerDiscount} disabled={pending}
                onChange={(e) => setOwnerDiscount(e.target.value)} className="w-24 rounded border border-border bg-background px-2 py-1 text-right" />
            </label>
          )}
          <p className="flex justify-between text-2xl font-bold"><span>Cəmi</span><span>{priced.total_amount.toFixed(2)} AZN</span></p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Ödəniş üsulu">
            {(["cash", "card", "other"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={payment === m} disabled={pending} onClick={() => setPayment(m)}
                className={`rounded-lg border px-2 py-2 text-sm ${payment === m ? "border-primary bg-primary/10 font-semibold" : "border-border"}`}>
                {m === "cash" ? "Nağd" : m === "card" ? "Kart" : "Digər"}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void complete()} disabled={lines.length === 0 || (pending && outcome?.kind !== "error")}
            className="w-full rounded-lg bg-primary py-3 text-lg font-semibold text-primary-foreground disabled:opacity-50">
            {pending && outcome?.kind === "error" ? "Yenidən göndər" : "Tamamla"}
          </button>
          {outcome && (
            <p role="status" className={`text-sm ${outcome.kind === "posted" ? "text-green-700" : outcome.kind === "needs_owner" ? "text-amber-700" : "text-destructive"}`}>
              {outcome.text}{" "}
              {outcome.saleId && <Link href={`/admin/counter/receipt/${outcome.saleId}`} className="underline">Qəbz</Link>}
            </p>
          )}
        </section>
        <PickupPanel />
      </aside>

      {picker && <VariantPicker items={picker} onPick={addItem} onClose={() => setPicker(null)} />}
    </div>
  );
}
