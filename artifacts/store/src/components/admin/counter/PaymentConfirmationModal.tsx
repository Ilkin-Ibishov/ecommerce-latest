import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Banknote, CreditCard, HelpCircle, Loader2 } from "lucide-react";

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
  const tenderedNum = parseFloat(tenderedAmount);
  const isCash = paymentMethod === "cash";
  const hasTendered = tenderedAmount.trim() !== "" && !isNaN(tenderedNum);
  const isSufficient = hasTendered && tenderedNum >= totalAmount;
  const changeDue = isSufficient ? Math.round((tenderedNum - totalAmount) * 100) / 100 : 0;

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
          <DialogTitle className="text-xl">Satışı Təsdiqlə</DialogTitle>
          <DialogDescription>
            Ödəniş üsulunu və məbləği yoxlayaraq satışı tamamlayın.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Total Amount Display */}
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Yekun Məbləğ</span>
            <p className="text-3xl font-bold tracking-tight text-primary">
              {totalAmount.toFixed(2)} <span className="text-lg">AZN</span>
            </p>
          </div>

          {/* Payment Method Selector */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-muted-foreground">
              Ödəniş Üsulu
            </label>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Ödəniş üsulu">
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
                Nağd
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
                Kart
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
                Digər
              </button>
            </div>
          </div>

          {/* Cash Change Calculator */}
          {isCash && (
            <div className="space-y-3 rounded-lg border border-border bg-card p-3.5">
              <div>
                <label htmlFor="tendered-amount-modal" className="block text-sm font-medium">
                  Təqdim edilən nağd məbləğ (AZN)
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
                    {amt === totalAmount ? `Dəqiq (${amt.toFixed(2)})` : `${amt} AZN`}
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
                      <span className="text-sm font-semibold">Qaytarılacaq Qalıq:</span>
                      <span className="text-xl font-bold tabular-nums">{changeDue.toFixed(2)} AZN</span>
                    </div>
                  ) : (
                    <p className="text-xs font-medium">
                      Təqdim edilən məbləğ kifayət deyil ({tenderedNum.toFixed(2)} &lt; {totalAmount.toFixed(2)} AZN)
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Alıcının ödədiyi məbləği daxil edin (məs: 50 AZN)
                </p>
              )}
            </div>
          )}

          {paymentMethod === "card" && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Müştəridən POS terminal vasitəsilə <strong>{totalAmount.toFixed(2)} AZN</strong> ödəniş qəbul edin və təsdiqləyin.
            </div>
          )}

          {paymentMethod === "other" && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Digər ödəniş kanalı ilə <strong>{totalAmount.toFixed(2)} AZN</strong> məbləğində ödəniş qeyd olunacaq.
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
            Ləğv et
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={onConfirm}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Təsdiqlə və Satışı Tamamla
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
