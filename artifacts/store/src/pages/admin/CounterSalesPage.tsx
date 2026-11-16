import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiUrl } from "@/lib/api";
import { adminFetch, adminJson } from "@/lib/admin-fetch";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";

interface Sale {
  id: string;
  sale_number: number;
  posting_date: string;
  payment_method: string;
  total_amount: number;
  status: "posted" | "needs_owner" | "voided";
  needs_owner_reason: string | null;
  total_mismatch?: boolean;
  cashier?: { full_name: string | null } | null;
}
interface FlaggedLine {
  sale_id: string; line_no: number; quantity: number; list_unit_price: number; charged_unit_price: number;
  price_mismatch: boolean; reservation_override: boolean; posted_after_count: boolean;
  counter_sales: { sale_number: number; posting_date: string; status: string } | null;
}

export default function CounterSalesPage() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"all" | "flagged">("all");
  const [sales, setSales] = useState<Sale[]>([]);
  const [flagged, setFlagged] = useState<{ lines: FlaggedLine[]; sales: Sale[] }>({ lines: [], sales: [] });
  const [isOwner, setIsOwner] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const getStatusText = (status: Sale["status"]) => {
    switch (status) {
      case "posted": return t("Admin.Counter.statusPosted");
      case "needs_owner": return t("Admin.Counter.statusNeedsOwner");
      case "voided": return t("Admin.Counter.statusVoided");
    }
  };

  const load = () => {
    adminFetch(apiUrl("/admin/counter/sales")).then((r) => (r.ok ? r.json() : [])).then(setSales).catch(() => {});
    if (isOwner) adminFetch(apiUrl("/admin/counter/flagged")).then((r) => (r.ok ? r.json() : { lines: [], sales: [] })).then(setFlagged).catch(() => {});
  };

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("users").select("role").eq("id", user.id).single();
      setIsOwner(data?.role === "admin");
    });
  }, []);
  useEffect(load, [isOwner]);

  const act = async (path: string, body?: object) => {
    setMessage(null);
    try {
      await adminJson(apiUrl(path), { method: "POST", body: JSON.stringify(body ?? {}) });
      load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const voidSale = (s: Sale) => {
    const reason = prompt(t("Admin.Counter.voidPrompt").replace("{saleNumber}", String(s.sale_number)));
    if (reason?.trim()) void act(`/admin/counter/sales/${s.id}/void`, { reason });
  };

  const row = (s: Sale) => (
    <tr key={s.id} className="border-b border-border hover:bg-muted/40 transition-colors">
      <td className="px-3 py-2.5"><Link href={`/admin/counter/receipt/${s.id}`} className="font-medium underline">#{s.sale_number}</Link></td>
      <td className="px-3 py-2.5 text-muted-foreground">{new Date(s.posting_date).toLocaleString(locale)}</td>
      <td className="px-3 py-2.5">{s.cashier?.full_name ?? "—"}</td>
      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{Number(s.total_amount).toFixed(2)} AZN</td>
      <td className="px-4 py-2.5">{getStatusText(s.status)}{s.total_mismatch && ` · ${t("Admin.Counter.amountMismatch")}`}</td>
      {isOwner && (
        <td className="px-3 py-2.5 space-x-2 text-right">
          {s.status === "needs_owner" && <button type="button" onClick={() => void act(`/admin/counter/sales/${s.id}/post-pending`)} className="text-primary underline">{t("Admin.Counter.postPendingStock")}</button>}
          {s.status !== "voided" && <button type="button" onClick={() => voidSale(s)} className="text-destructive underline">{t("Admin.Counter.voidSale")}</button>}
        </td>
      )}
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("Admin.Counter.salesTitle")}</h1>
        <Link href="/admin/counter" className="text-sm text-primary underline">{t("Admin.Counter.backToCounter")}</Link>
      </div>
      {isOwner && (
        <div className="flex gap-2" role="tablist">
          {(["all", "flagged"] as const).map((tTab) => (
            <button key={tTab} type="button" role="tab" aria-selected={tab === tTab} onClick={() => setTab(tTab)}
              className={`rounded-lg px-3 py-1.5 text-sm ${tab === tTab ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {tTab === "all" ? t("Admin.Counter.tabAll") : t("Admin.Counter.tabFlagged").replace("{count}", String(flagged.sales.length + flagged.lines.length))}
            </button>
          ))}
        </div>
      )}
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">№</th>
              <th className="px-3 py-2.5 font-medium">{t("Admin.Counter.colDate")}</th>
              <th className="px-3 py-2.5 font-medium">{t("Admin.Counter.colCashier")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("Admin.Counter.colAmount")}</th>
              <th className="px-4 py-2.5 font-medium">{t("Admin.Counter.colStatus")}</th>
              {isOwner && <th className="px-3 py-2.5 text-right font-medium">{t("Admin.Counter.colActions")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">{(tab === "all" ? sales : flagged.sales).map(row)}</tbody>
        </table>
      </div>
      {tab === "flagged" && flagged.lines.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t("Admin.Counter.flaggedLinesTitle")}</h2>
          <ul className="space-y-1 text-sm">
            {flagged.lines.map((l) => (
              <li key={`${l.sale_id}-${l.line_no}`}>
                <Link href={`/admin/counter/receipt/${l.sale_id}`} className="underline">#{l.counter_sales?.sale_number}</Link>
                {" "}{t("Admin.Counter.linePrefix")} {l.line_no}:
                {l.price_mismatch && ` ${t("Admin.Counter.flagPriceMismatch").replace("{charged}", Number(l.charged_unit_price).toFixed(2)).replace("{list}", Number(l.list_unit_price).toFixed(2))}`}
                {l.reservation_override && ` ${t("Admin.Counter.flagReservationOverride")}`}
                {l.posted_after_count && ` ${t("Admin.Counter.flagPostedAfterCount")}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
