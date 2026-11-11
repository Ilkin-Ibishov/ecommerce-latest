import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";

interface ReceiptLine {
  line_no: number; quantity: number; charged_unit_price: number; net_line_total: number;
  product_variants: { sku: string | null; products: { product_translations: { lang_code: string; title: string }[] } | null } | null;
}
interface ReceiptSale {
  sale_number: number; sold_at: string; payment_method: string; status: string;
  bundle_discount: number; owner_discount: number; total_amount: number;
  cashier?: { full_name: string | null } | null; lines: ReceiptLine[];
}

const PAYMENT: Record<string, string> = { cash: "Nağd", card: "Kart", other: "Digər" };
const title = (l: ReceiptLine) => {
  const t = l.product_variants?.products?.product_translations ?? [];
  return t.find((x) => x.lang_code === "az")?.title ?? t[0]?.title ?? l.product_variants?.sku ?? "";
};

// A plain receipt (M3 spec §11): a view of the sale document, printed by the browser on narrow
// paper. No fiscal fields; if the accountant's written answer adds any, they go here only.
export default function CounterReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [sale, setSale] = useState<ReceiptSale | null>(null);
  const [shop, setShop] = useState<{ name: string; phone: string }>({ name: "", phone: "" });

  useEffect(() => {
    adminFetch(apiUrl(`/admin/counter/sales/${id}`)).then((r) => (r.ok ? r.json() : null)).then(setSale).catch(() => {});
    fetch(apiUrl("/site-settings")).then((r) => (r.ok ? r.json() : null)).then((s) => {
      if (!s) return;
      const name = typeof s.store_name === "object" ? s.store_name?.az ?? Object.values(s.store_name ?? {})[0] : s.store_name;
      setShop({ name: String(name ?? ""), phone: String(s.contact?.phone ?? "") });
    }).catch(() => {});
  }, [id]);

  if (!sale) return <p className="p-6 text-muted-foreground">Yüklənir…</p>;
  const discount = Number(sale.bundle_discount) + Number(sale.owner_discount);

  return (
    <div className="mx-auto max-w-[80mm] bg-white p-4 font-mono text-[12px] text-black print:p-0">
      <style>{"@media print { body * { visibility: hidden; } #receipt, #receipt * { visibility: visible; } #receipt { position: absolute; left: 0; top: 0; width: 80mm; } }"}</style>
      <div id="receipt">
        <p className="text-center text-sm font-bold">{shop.name}</p>
        {shop.phone && <p className="text-center">{shop.phone}</p>}
        <p className="mt-2">Satış #{sale.sale_number}{sale.status === "voided" && " (LƏĞV EDİLİB)"}</p>
        <p>{new Date(sale.sold_at).toLocaleString("az-AZ")}</p>
        {sale.cashier?.full_name && <p>Kassir: {sale.cashier.full_name.split(" ")[0]}</p>}
        <hr className="my-2 border-dashed border-black" />
        {sale.lines.map((l) => (
          <div key={l.line_no} className="mb-1">
            <p>{title(l)}</p>
            <p className="flex justify-between"><span>{l.quantity} × {Number(l.charged_unit_price).toFixed(2)}</span><span>{Number(l.net_line_total).toFixed(2)}</span></p>
          </div>
        ))}
        <hr className="my-2 border-dashed border-black" />
        {discount > 0 && <p className="flex justify-between"><span>Endirim</span><span>−{discount.toFixed(2)}</span></p>}
        <p className="flex justify-between text-sm font-bold"><span>CƏMİ</span><span>{Number(sale.total_amount).toFixed(2)} AZN</span></p>
        <p>Ödəniş: {PAYMENT[sale.payment_method] ?? sale.payment_method}</p>
        <p className="mt-2 text-center">Təşəkkür edirik!</p>
      </div>
      <button type="button" onClick={() => window.print()} className="mt-4 w-full rounded bg-black py-2 font-sans text-white print:hidden">Çap et</button>
    </div>
  );
}
