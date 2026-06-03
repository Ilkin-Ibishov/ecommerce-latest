import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { createClient } from "@/lib/supabase/client";

const ACTION_COLORS: Record<string, string> = {
  create_product: "text-green-400",
  update_product: "text-blue-400",
  delete_product: "text-red-400",
  update_order_status: "text-yellow-400",
};

export default function AdminAuditPage() {
  const search = useSearch();
  const page = Math.max(1, parseInt(new URLSearchParams(search).get("page") ?? "1", 10));
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const [logs, setLogs] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    (supabase as any).from("audit_log")
      .select("*, users(full_name)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1)
      .then(({ data, count: total }: any) => { setLogs(data ?? []); setCount(total ?? 0); setLoading(false); });
  }, [page]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <span className="text-sm text-muted-foreground">{count} entries</span>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">Time</th>
              <th className="text-left px-4 py-3 font-medium">Admin</th>
              <th className="text-left px-4 py-3 font-medium">Action</th>
              <th className="text-left px-4 py-3 font-medium">Entity</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">No audit entries yet.</td></tr>
            ) : logs.map((log: any) => (
              <tr key={log.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-xs">{log.users?.full_name ?? "Unknown"}</td>
                <td className={`px-4 py-3 text-xs font-mono ${ACTION_COLORS[log.action] ?? "text-muted-foreground"}`}>{log.action}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {log.entity}
                  {log.entity_id && <> · <span className="font-mono">{String(log.entity_id).slice(0, 8)}</span></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {count > pageSize && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: Math.ceil(count / pageSize) }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/admin/audit?page=${p}`}
              className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition ${p === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}>
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
