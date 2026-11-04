import { useState, useEffect } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface VariantOption {
  id: string;
  sku: string;
  title: string;
  price: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateDepositModal({ open, onClose, onCreated }: Props) {
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [agreedPrice, setAgreedPrice] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    adminFetch(apiUrl("/admin/stocktakes/variants"))
      .then((r) => r.ok ? r.json() : [])
      .then((data: any[]) => {
        const opts = data.map((v) => ({
          id: v.id,
          sku: v.sku,
          title: v.products?.product_translations?.[0]?.title ?? v.products?.title ?? v.sku,
          price: Number(v.price),
        }));
        setVariants(opts);
        if (opts.length > 0 && !variantId) {
          setVariantId(opts[0].id);
          setAgreedPrice(String(opts[0].price));
        }
      })
      .catch(() => {});
  }, [open]);

  const handleVariantChange = (id: string) => {
    setVariantId(id);
    const chosen = variants.find((v) => v.id === id);
    if (chosen && !agreedPrice) setAgreedPrice(String(chosen.price));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!variantId || !customerName.trim() || !customerPhone.trim()) {
      setError("Please fill in variant, customer name, and phone.");
      return;
    }
    const priceNum = parseFloat(agreedPrice);
    const paidNum = paidAmount ? parseFloat(paidAmount) : 0;
    const qtyNum = parseFloat(quantity) || 1;
    if (isNaN(priceNum) || priceNum < 0) {
      setError("Please enter a valid agreed price.");
      return;
    }
    if (isNaN(paidNum) || paidNum < 0 || paidNum > priceNum) {
      setError("Deposit amount cannot be negative or exceed agreed price.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch(apiUrl("/admin/reservations"), {
        method: "POST",
        body: JSON.stringify({
          variant_id: variantId,
          quantity: qtyNum,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          hold_type: "deposit",
          agreed_price: priceNum,
          paid_amount: paidNum,
          notes: notes.trim() || null,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to create reservation");
      }
      setSaving(false);
      onCreated();
      onClose();
    } catch (err: any) {
      setSaving(false);
      setError(err.message || "Failed to create deposit");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Counter Deposit / Reservation</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {error && <div className="p-2 rounded bg-destructive/10 text-destructive">{error}</div>}
          <div>
            <label className="font-semibold block mb-1">Item / Variant</label>
            <select
              value={variantId}
              onChange={(e) => handleVariantChange(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border border-border bg-background"
              required
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title} ({v.sku}) — {v.price.toFixed(2)} AZN
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold block mb-1">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Full name"
                className="w-full px-2.5 py-1.5 rounded border border-border bg-background"
                required
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Customer Phone</label>
              <input
                type="text"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="+994..."
                className="w-full px-2.5 py-1.5 rounded border border-border bg-background"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="font-semibold block mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-border bg-background"
                required
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Agreed Price (AZN)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={agreedPrice}
                onChange={(e) => setAgreedPrice(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-border bg-background"
                required
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Deposit Paid (AZN)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-2.5 py-1.5 rounded border border-border bg-background"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold block mb-1">Expiry Date (Optional)</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-border bg-background"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Notes (Optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Counter note"
                className="w-full px-2.5 py-1.5 rounded border border-border bg-background"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 rounded border border-border hover:bg-muted text-muted-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              {saving ? "Creating…" : "Create Deposit (< 1 min)"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
