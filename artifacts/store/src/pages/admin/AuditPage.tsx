import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { useAdminList } from "@/lib/hooks/useAdminList";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { TableEmptyState } from "@/components/admin/TableEmptyState";

const ACTION_COLORS: Record<string, string> = {
  create_product: "text-green-400",
  update_product: "text-blue-400",
  delete_product: "text-red-400",
  update_order_status: "text-yellow-400",
};

const PAGE_SIZE = 50;

interface AuditLogRow {
  id: string;
  created_at: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  users: { full_name: string | null } | null;
}

// Column set / labels / cell rendering preserved from the prior hand-rolled
// table (R6.3, R6.5, R6.6). The dynamic per-row action color moves into a span
// inside the cell (DataTable cell classes are static per column).
const COLUMNS: Column<AuditLogRow>[] = [
  {
    key: "time",
    header: "Time",
    align: "left",
    className: "text-muted-foreground text-xs whitespace-nowrap",
    cell: (log) => new Date(log.created_at).toLocaleString(),
  },
  {
    key: "admin",
    header: "Admin",
    align: "left",
    className: "text-xs",
    cell: (log) => log.users?.full_name ?? "Unknown",
  },
  {
    key: "action",
    header: "Action",
    align: "left",
    className: "text-xs font-mono",
    cell: (log) => (
      <span className={ACTION_COLORS[log.action] ?? "text-muted-foreground"}>{log.action}</span>
    ),
  },
  {
    key: "entity",
    header: "Entity",
    align: "left",
    className: "text-xs text-muted-foreground",
    cell: (log) => (
      <>
        {log.entity}
        {log.entity_id && <> · <span className="font-mono">{String(log.entity_id).slice(0, 8)}</span></>}
      </>
    ),
  },
];

/**
 * Audit-log list view. Keyed by the active filter combination (outer component)
 * so a filter change remounts and refetches (the bound filters are not
 * `useAdminList` inputs, mirroring the OrdersPage status-tab pattern). The hook
 * owns URL-driven pagination; this page has no search, so no `<SearchInput>` is
 * rendered and the committed search stays empty. The action/date filters,
 * columns, and `?page=` URL behavior are preserved.
 */
function AuditListView({
  actionFilter,
  dateFrom,
  dateTo,
  actionTypes,
  onActionFilterChange,
  onDateFromChange,
  onDateToChange,
}: {
  actionFilter: string;
  dateFrom: string;
  dateTo: string;
  actionTypes: string[];
  onActionFilterChange: (value: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
}) {
  // Fetcher runs the page's existing Supabase query unchanged: same
  // select/count, order, optional eq/gte/lte filters, and range window.
  const fetcher = useCallback(
    async (args: { offset: number; limit: number; search: string; signal: AbortSignal }) => {
      const supabase = createClient();
      let query = supabase.from("audit_log")
        .select("*, users(full_name)", { count: "exact" })
        .order("created_at", { ascending: false });

      if (actionFilter) {
        query = query.eq("action", actionFilter);
      }
      if (dateFrom) {
        query = query.gte("created_at", dateFrom);
      }
      if (dateTo) {
        query = query.lte("created_at", dateTo + "T23:59:59");
      }

      const { data, count } = await query.range(args.offset, args.offset + args.limit - 1);
      return { rows: (data ?? []) as unknown as AuditLogRow[], count: count ?? 0 };
    },
    [actionFilter, dateFrom, dateTo],
  );

  const { rows: logs, count, loading, page, totalPages } = useAdminList<AuditLogRow>({
    fetcher,
    basePath: "/admin/audit",
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <span className="text-sm text-muted-foreground">{count} entries</span>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={actionFilter}
          onChange={(e) => onActionFilterChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm"
        >
          <option value="">All actions</option>
          {actionTypes.map((action) => (
            <option key={action} value={action}>{action}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">From:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">To:</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm"
          />
        </div>
      </div>

      <DataTable<AuditLogRow>
        columns={COLUMNS}
        rows={logs}
        loading={loading}
        getRowKey={(log) => String(log.id)}
        empty={<TableEmptyState colSpan={4} message="No audit entries found." />}
      />

      <Pagination page={page} totalPages={totalPages} buildHref={(p) => `/admin/audit?page=${p}`} />
    </div>
  );
}

export default function AdminAuditPage() {
  const [, setLocation] = useLocation();

  // Filter state lives in the outer component so it survives the inner view's
  // remount (which is keyed by the filter combination to force a refetch).
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Distinct action types for the dropdown, fetched once on mount.
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  useEffect(() => {
    const supabase = createClient();
    supabase.from("audit_log")
      .select("action")
      .then(({ data }) => {
        const distinct = [...new Set((data ?? []).map((r) => r.action))].sort() as string[];
        setActionTypes(distinct);
      });
  }, []);

  // Filter changes reset to page 1 (preserving the prior URL behavior) and, via
  // the key change below, remount the list view so it refetches.
  const handleActionFilterChange = (value: string) => {
    setActionFilter(value);
    setLocation("/admin/audit?page=1");
  };
  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    setLocation("/admin/audit?page=1");
  };
  const handleDateToChange = (value: string) => {
    setDateTo(value);
    setLocation("/admin/audit?page=1");
  };

  return (
    <AuditListView
      key={`${actionFilter}|${dateFrom}|${dateTo}`}
      actionFilter={actionFilter}
      dateFrom={dateFrom}
      dateTo={dateTo}
      actionTypes={actionTypes}
      onActionFilterChange={handleActionFilterChange}
      onDateFromChange={handleDateFromChange}
      onDateToChange={handleDateToChange}
    />
  );
}
