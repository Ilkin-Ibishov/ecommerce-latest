import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Banknote, CreditCard, HelpCircle, Loader2 } from "lucide-react";
import { computeChange } from "./counter-input";
import { useI18n } from "@/lib/i18n/context";

export function PaymentConfirmationModal({
  open,
  onClose,
  onConfirm,
  totalAmount,
  paymentMethod,
  onPaymentMethodChange,
  tenderedAmount,
  onTenderedAmountChange,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  totalAmount: number;
  paymentMethod: "cash" | "card" | "other";
  onPaymentMethodChange: (m: "cash" | "card" | "other") => void;
  tenderedAmount: string;
  onTenderedAmountChange: (val: string) => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const tenderedNum = parseFloat(tenderedAmount);
  const isCash = paymentMethod === "cash";
  const hasTendered = tenderedAmount.trim() !== "" && !isNaN(tenderedNum);
  const { sufficient: isSufficient, change: changeDue } = computeChange(tenderedAmount, totalAmount);

  // Quick cash note suggestions (e.g. 10, 20, 50, 100 AZN)
  const quickSuggestions = useMemo(() => {
    const list: number[] = [totalAmount];
    const notes = [5, 10, 20, 50, 100, 200];
    for (const note of notes) {
      if (note > totalAmount && !list.includes(note)) {
        list.push(note);
      }
    }
    return list.slice(0, 4);
  }, [totalAmount]);

  const canConfirm = !pending && (!isCash || isSufficient);

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val && !pending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("Admin.Counter.confirmSaleTitle")}</DialogTitle>
          <DialogDescription>
            {t("Admin.Counter.confirmSaleDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Total Amount Display */}
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{t("Admin.Counter.finalAmount")}</span>
            <p className="text-3xl font-bold tracking-tight text-primary">
              {totalAmount.toFixed(2)} <span className="text-lg">AZN</span>
            </p>
          </div>

          {/* Payment Method Selector */}
          <div>
            <span id="payment-method-label" className="mb-1.5 block text-xs font-semibold uppercase text-muted-foreground">
              {t("Admin.Counter.paymentMethodLabel")}
            </span>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="payment-method-label">
              <button
                type="button"
                role="radio"
                aria-checked={paymentMethod === "cash"}
                disabled={pending}
                onClick={() => onPaymentMethodChange("cash")}
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                  paymentMethod === "cash"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                <Banknote className="h-4 w-4" />
                {t("Admin.Counter.paymentCash")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={paymentMethod === "card"}
                disabled={pending}
                onClick={() => onPaymentMethodChange("card")}
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                  paymentMethod === "card"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                <CreditCard className="h-4 w-4" />
                {t("Admin.Counter.paymentCard")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={paymentMethod === "other"}
                disabled={pending}
                onClick={() => onPaymentMethodChange("other")}
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                  paymentMethod === "other"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                <HelpCircle className="h-4 w-4" />
                {t("Admin.Counter.paymentOther")}
              </button>
            </div>
          </div>

          {/* Cash Change Calculator */}
          {isCash && (
            <div className="space-y-3 rounded-lg border border-border bg-card p-3.5">
              <div>
                <label htmlFor="tendered-amount-modal" className="block text-sm font-medium">
                  {t("Admin.Counter.tenderedCashLabel")}
                </label>
                <input
                  id="tendered-amount-modal"
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  disabled={pending}
                  value={tenderedAmount}
                  onChange={(e) => onTenderedAmountChange(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex flex-wrap gap-1.5">
                {quickSuggestions.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    disabled={pending}
                    onClick={() => onTenderedAmountChange(amt.toFixed(2))}
                    className="rounded-md border border-border bg-muted/50 px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    {amt === totalAmount ? t("Admin.Counter.exactAmount").replace("{amount}", amt.toFixed(2)) : `${amt} AZN`}
                  </button>
                ))}
              </div>

              {/* Dynamic Change Due Display */}
              {hasTendered ? (
                <div
                  className={`rounded-lg p-3 transition-colors ${
                    isSufficient
                      ? "border border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400"
                      : "border border-destructive/20 bg-destructive/10 text-destructive"
                  }`}
                >
                  {isSufficient ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{t("Admin.Counter.changeDueLabel")}</span>
                      <span className="text-xl font-bold tabular-nums">{changeDue.toFixed(2)} AZN</span>
                    </div>
                  ) : (
                    <p className="text-xs font-medium">
                      {t("Admin.Counter.insufficientTender").replace("{tendered}", tenderedNum.toFixed(2)).replace("{total}", totalAmount.toFixed(2))}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("Admin.Counter.enterTenderedPrompt")}
                </p>
              )}
            </div>
          )}

          {paymentMethod === "card" && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              {t("Admin.Counter.cardInstructions").replace("{amount}", totalAmount.toFixed(2))}
            </div>
          )}

          {paymentMethod === "other" && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              {t("Admin.Counter.otherInstructions").replace("{amount}", totalAmount.toFixed(2))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {t("Admin.Counter.cancel")}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={onConfirm}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("Admin.Counter.confirmAndComplete")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
