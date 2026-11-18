import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { useI18n } from "@/lib/i18n/context";
import type { CartLine, Outcome } from "@/components/admin/counter/types";
import { computeChange } from "@/components/admin/counter/counter-input";

interface SaleInput {
  lines: CartLine[];
  displayedTotal: number;
  payment: "cash" | "card" | "other";
  isOwner: boolean;
  ownerDiscount: string;
  tenderedAmount: string;
  // Clears the cart, discount and tender once the server has the sale.
  onPosted: () => void;
}

// Posting a counter sale. After Complete the cart is frozen until the outcome is known, and a
// retry resends the same id (design note Q2, audit A10.2).
export function useCounterSale({ lines, displayedTotal, payment, isOwner, ownerDiscount, tenderedAmount, onPosted }: SaleInput) {
  const { t } = useI18n();
  const [saleId, setSaleId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false); // Complete sent, outcome unknown
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [completedReceipt, setCompletedReceipt] = useState<{ id: string; tendered?: number | null; change?: number | null } | null>(null);
  const soldAtRef = useRef<string | null>(null);

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

  const complete = async () => {
    setPending(true);
    setOutcome(null);
    try {
      const res = await adminFetch(apiUrl("/admin/counter/sales"), {
        method: "POST",
        body: JSON.stringify({
          id: saleId, sold_at: (soldAtRef.current ??= new Date().toISOString()), payment_method: payment,
          owner_discount: isOwner ? Number(ownerDiscount) || 0 : 0, displayed_total: displayedTotal,
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
      const finalChange = finalTendered !== null && serverTotal === displayedTotal ? serverChange : null;

      setShowConfirm(false);
      setOutcome(data.status === "needs_owner"
        ? { kind: "needs_owner", text: t("Admin.Counter.saleNeedsOwner").replace("{saleNumber}", String(data.sale_number)), saleId: data.id }
        : { kind: "posted", text: t("Admin.Counter.salePosted").replace("{saleNumber}", String(data.sale_number)), saleId: data.id });
      setCompletedReceipt({ id: data.id, tendered: finalTendered, change: finalChange });
      onPosted();
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

  return {
    saleId, pending, outcome, setOutcome, showConfirm, setShowConfirm, completedReceipt, setCompletedReceipt,
    canDiscard: pending && outcome?.kind === "error" && failedAttempts >= 3,
    complete, handleOpenConfirm, discardAttempt,
  };
}
