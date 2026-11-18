import { useI18n } from "@/lib/i18n/context";
import type { Outcome } from "./types";

export function CounterCheckoutPanel({
  priced,
  isOwner,
  ownerDiscount,
  onOwnerDiscountChange,
  payment,
  onPaymentChange,
  tenderedAmount,
  onTenderedAmountChange,
  hasValidCashTender,
  changeAmount,
  pending,
  outcome,
  hasLines,
  lookupBusy,
  onCompleteClick,
  onViewReceipt,
  canDiscard,
  onDiscard,
}: {
  priced: { bundle_discount: number; total_amount: number };
  isOwner: boolean;
  ownerDiscount: string;
  onOwnerDiscountChange: (val: string) => void;
  payment: "cash" | "card" | "other";
  onPaymentChange: (p: "cash" | "card" | "other") => void;
  tenderedAmount: string;
  onTenderedAmountChange: (val: string) => void;
  hasValidCashTender: boolean;
  changeAmount: number;
  pending: boolean;
  outcome: Outcome | null;
  hasLines: boolean;
  lookupBusy?: boolean;
  onCompleteClick: () => void;
  onViewReceipt: (saleId: string) => void;
  canDiscard?: boolean;
  onDiscard?: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      {priced.bundle_discount > 0 && (
        <p className="flex justify-between text-sm">
          <span>{t("Admin.Counter.bundleDiscount")}</span>
          <span>−{priced.bundle_discount.toFixed(2)}</span>
        </p>
      )}
      {isOwner && (
        <label className="flex items-center justify-between gap-2 text-sm">
          {t("Admin.Counter.ownerDiscountLabel")}
          <input
            type="number"
            min="0"
            step="0.01"
            value={ownerDiscount}
            disabled={pending}
            onChange={(e) => onOwnerDiscountChange(e.target.value)}
            className="w-24 rounded border border-border bg-background px-2 py-1 text-right"
          />
        </label>
      )}
      <p className="flex justify-between text-2xl font-bold">
        <span>{t("Admin.Counter.total")}</span>
        <span>{priced.total_amount.toFixed(2)} AZN</span>
      </p>

      {/* Tender Radio Selector */}
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("Admin.Counter.paymentMethod")}>
        {(["cash", "card", "other"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={payment === m}
            disabled={pending}
            onClick={() => onPaymentChange(m)}
            className={`rounded-lg border px-2 py-2 text-sm ${
              payment === m ? "border-primary bg-primary/10 font-semibold" : "border-border"
            }`}
          >
            {m === "cash" ? t("Admin.Counter.paymentCash") : m === "card" ? t("Admin.Counter.paymentCard") : t("Admin.Counter.paymentOther")}
          </button>
        ))}
      </div>

      {/* Cash Change Calculator */}
      {payment === "cash" && (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2.5 text-sm">
          <label className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("Admin.Counter.tenderedAmountLabel")}</span>
            <input
              type="number"
              step="0.01"
              min="0"
              disabled={pending}
              value={tenderedAmount}
              onChange={(e) => onTenderedAmountChange(e.target.value)}
              placeholder={priced.total_amount > 0 ? priced.total_amount.toFixed(2) : "0.00"}
              className="w-24 rounded border border-border bg-background px-2 py-1 text-right font-semibold tabular-nums"
            />
          </label>
          {tenderedAmount.trim() !== "" && (
            <p className="flex justify-between text-xs font-medium">
              <span className="text-muted-foreground">{t("Admin.Counter.changeLabel")}</span>
              <span className={`tabular-nums ${hasValidCashTender ? "font-bold text-green-600 dark:text-green-400" : "text-destructive"}`}>
                {hasValidCashTender ? `${changeAmount.toFixed(2)} AZN` : t("Admin.Counter.insufficientAmount")}
              </span>
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onCompleteClick}
        disabled={!hasLines || lookupBusy || (pending && outcome?.kind !== "error")}
        className="w-full rounded-lg bg-primary py-3 text-lg font-semibold text-primary-foreground disabled:opacity-50"
      >
        {pending && outcome?.kind === "error" ? t("Admin.Counter.resend") : t("Admin.Counter.complete")}
      </button>

      {canDiscard && (
        <button
          type="button"
          onClick={onDiscard}
          className="w-full rounded-lg border border-border py-2 text-sm font-semibold hover:bg-muted"
        >
          {t("Admin.Counter.startOver")}
        </button>
      )}

      {outcome && (
        <p
          role="status"
          className={`text-sm ${
            outcome.kind === "posted" ? "text-green-700" : outcome.kind === "needs_owner" ? "text-amber-700" : "text-destructive"
          }`}
        >
          {outcome.text}{" "}
          {outcome.saleId && (
            <button
              type="button"
              onClick={() => onViewReceipt(outcome.saleId!)}
              className="font-medium underline hover:opacity-80"
            >
              {t("Admin.Counter.viewReceipt")}
            </button>
          )}
        </p>
      )}
    </section>
  );
}
