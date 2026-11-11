import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiUrl } from "@/lib/api";
import { adminFetch, adminJson } from "@/lib/admin-fetch";
import { createClient } from "@/lib/supabase/client";

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

const STATUS: Record<Sale["status"], string> = { posted: "Tamamlanıb", needs_owner: "Sahibkar yoxlamalıdır", voided: "Ləğv edilib" };

// Sale list for everyone; the owner also gets the flagged lines and pending sales, and the
// void / post-pending actions (M3 spec §13).
export default function CounterSalesPage() {
  const [tab, setTab] = useState<"all" | "flagged">("all");
  const [sales, setSales] = useState<Sale[]>([]);
  const [flagged, setFlagged] = useState<{ lines: FlaggedLine[]; sales: Sale[] }>({ lines: [], sales: [] });
  const [isOwner, setIsOwner] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    const reason = prompt(`Satış #${s.sale_number} ləğv edilsin. Səbəb:`);
    if (reason?.trim()) void act(`/admin/counter/sales/${s.id}/void`, { reason });
  };

  const row = (s: Sale) => (
    <tr key={s.id} className="border-b border-border">
      <td className="py-2"><Link href={`/admin/counter/receipt/${s.id}`} className="underline">#{s.sale_number}</Link></td>
      <td>{new Date(s.posting_date).toLocaleString("az-AZ")}</td>
      <td>{s.cashier?.full_name ?? ""}</td>
      <td className="text-right tabular-nums">{Number(s.total_amount).toFixed(2)}</td>
      <td>{STATUS[s.status]}{s.total_mismatch && " · ekran məbləği fərqli"}</td>
      {isOwner && (
        <td className="space-x-2 text-right">
          {s.status === "needs_owner" && <button type="button" onClick={() => void act(`/admin/counter/sales/${s.id}/post-pending`)} className="text-primary underline">Stokdan çıx</button>}
          {s.status !== "voided" && <button type="button" onClick={() => voidSale(s)} className="text-destructive underline">Ləğv et</button>}
        </td>
      )}
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Kassa satışları</h1>
        <Link href="/admin/counter" className="text-sm text-primary underline">Kassaya qayıt</Link>
      </div>
      {isOwner && (
        <div className="flex gap-2" role="tablist">
          {(["all", "flagged"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {t === "all" ? "Hamısı" : `Yoxlanmalı (${flagged.sales.length + flagged.lines.length})`}
            </button>
          ))}
        </div>
      )}
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">№</th><th>Tarix</th><th>Kassir</th><th className="text-right">Məbləğ</th><th>Status</th>{isOwner && <th />}</tr>
        </thead>
        <tbody>{(tab === "all" ? sales : flagged.sales).map(row)}</tbody>
      </table>
      {tab === "flagged" && flagged.lines.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">İşarələnmiş sətirlər</h2>
          <ul className="space-y-1 text-sm">
            {flagged.lines.map((l) => (
              <li key={`${l.sale_id}-${l.line_no}`}>
                <Link href={`/admin/counter/receipt/${l.sale_id}`} className="underline">#{l.counter_sales?.sale_number}</Link>
                {" "}sətir {l.line_no}:
                {l.price_mismatch && ` qiymət ${Number(l.charged_unit_price).toFixed(2)} (siyahı ${Number(l.list_unit_price).toFixed(2)});`}
                {l.reservation_override && " rezervdəki mal satılıb;"}
                {l.posted_after_count && " sayımdan sonra yazılıb, stoku yoxlayın;"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
