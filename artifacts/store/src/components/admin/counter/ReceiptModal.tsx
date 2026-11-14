import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, Printer, PlusCircle } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";

interface ReceiptLine {
  line_no: number; quantity: number; charged_unit_price: number; net_line_total: number;
  product_variants: { sku: string | null; products: { product_translations: { lang_code: string; title: string }[] } | null } | null;
}
interface ReceiptSale {
  id: string; sale_number: number; sold_at: string; payment_method: string; status: string;
  bundle_discount: number; owner_discount: number; total_amount: number;
  cashier?: { full_name: string | null } | null; lines: ReceiptLine[];
}

const PAYMENT: Record<string, string> = { cash: "Nağd", card: "Kart", other: "Digər" };
const lineTitle = (l: ReceiptLine) => {
  const t = l.product_variants?.products?.product_translations ?? [];
  return t.find((x) => x.lang_code === "az")?.title ?? t[0]?.title ?? l.product_variants?.sku ?? "Məhsul";
};

export function ReceiptModal({
  saleId,
  tendered,
  change,
  onClose,
}: {
  saleId: string | null;
  tendered?: number | null;
  change?: number | null;
  onClose: () => void;
}) {
  const [sale, setSale] = useState<ReceiptSale | null>(null);
  const [shop, setShop] = useState<{ name: string; phone: string }>({ name: "", phone: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!saleId) return;
    setLoading(true);
    Promise.all([
      adminFetch(apiUrl(`/admin/counter/sales/${saleId}`)).then((r) => (r.ok ? r.json() : null)),
      fetch(apiUrl("/site-settings")).then((r) => (r.ok ? r.json() : null)),
    ]).then(([s, settings]) => {
      if (s) setSale(s);
      if (settings) {
        const name = typeof settings.store_name === "object"
          ? settings.store_name?.az ?? Object.values(settings.store_name ?? {})[0]
          : settings.store_name;
        setShop({ name: String(name ?? ""), phone: String(settings.contact?.phone ?? "") });
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [saleId]);

  if (!saleId) return null;

  const discount = sale ? Number(sale.bundle_discount) + Number(sale.owner_discount) : 0;

  return (
    <Dialog open={!!saleId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            Satış Tamamlandı
          </DialogTitle>
        </DialogHeader>

        {loading || !sale ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Qəbz məlumatları yüklənir…</p>
        ) : (
          <div className="space-y-4">
            <style>
              {`@media print {
                body * { visibility: hidden !important; }
                #inpage-receipt, #inpage-receipt * { visibility: visible !important; }
                #inpage-receipt {
                  position: fixed !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 80mm !important;
                  background: white !important;
                  color: black !important;
                  padding: 8px !important;
                  margin: 0 !important;
                  box-shadow: none !important;
                  border: none !important;
                }
              }`}
            </style>

            {/* Visual Receipt Paper View */}
            <div
              id="inpage-receipt"
              className="mx-auto max-w-[80mm] rounded-lg border border-border bg-muted/20 p-4 font-mono text-[12px] text-foreground print:bg-white print:text-black"
            >
              <p className="text-center text-sm font-bold">{shop.name || "Kassa Qəbzi"}</p>
              {shop.phone && <p className="text-center text-[11px] text-muted-foreground print:text-black">{shop.phone}</p>}
              <p className="mt-2 font-semibold">Satış #{sale.sale_number}{sale.status === "voided" && " (LƏĞV EDİLİB)"}</p>
              <p className="text-[11px] text-muted-foreground print:text-black">{new Date(sale.sold_at).toLocaleString("az-AZ")}</p>
              {sale.cashier?.full_name && <p className="text-[11px]">Kassir: {sale.cashier.full_name.split(" ")[0]}</p>}
              <hr className="my-2 border-dashed border-border print:border-black" />
              {sale.lines.map((l) => (
                <div key={l.line_no} className="mb-1.5">
                  <p className="truncate font-sans font-medium">{lineTitle(l)}</p>
                  <p className="flex justify-between tabular-nums">
                    <span>{l.quantity} × {Number(l.charged_unit_price).toFixed(2)}</span>
                    <span className="font-semibold">{Number(l.net_line_total).toFixed(2)} AZN</span>
                  </p>
                </div>
              ))}
              <hr className="my-2 border-dashed border-border print:border-black" />
              {discount > 0 && (
                <p className="flex justify-between tabular-nums">
                  <span>Endirim:</span>
                  <span>−{discount.toFixed(2)} AZN</span>
                </p>
              )}
              <p className="flex justify-between text-sm font-bold tabular-nums">
                <span>CƏMİ:</span>
                <span>{Number(sale.total_amount).toFixed(2)} AZN</span>
              </p>
              <p className="mt-1">Ödəniş üsulu: {PAYMENT[sale.payment_method] ?? sale.payment_method}</p>
              {sale.payment_method === "cash" && tendered != null && (
                <div className="mt-1 space-y-0.5 border-t border-dotted border-border pt-1 tabular-nums print:border-black">
                  <p className="flex justify-between">
                    <span>Ödənildi:</span>
                    <span>{tendered.toFixed(2)} AZN</span>
                  </p>
                  {change != null && (
                    <p className="flex justify-between font-bold">
                      <span>Qalıq:</span>
                      <span>{change.toFixed(2)} AZN</span>
                    </p>
                  )}
                </div>
              )}
              <p className="mt-3 text-center text-[11px] text-muted-foreground print:text-black">Təşəkkür edirik!</p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Printer className="h-4 w-4" />
                Çap et
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 font-medium hover:bg-muted"
              >
                <PlusCircle className="h-4 w-4" />
                Yeni Satış
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
