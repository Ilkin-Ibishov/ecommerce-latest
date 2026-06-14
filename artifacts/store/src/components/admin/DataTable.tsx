import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  loading: boolean;
  /** Rendered inside <tbody> when !loading && rows.length === 0 (e.g. <TableEmptyState/>). */
  empty: ReactNode;
  getRowKey: (row: Row) => string;
}

/**
 * Generic admin data table. Reproduces the shared table chrome used across the
 * admin list pages (OrdersPage, UsersPage): a bordered card wrapping a
 * horizontally scrollable table. When !loading && rows.length === 0 the `empty`
 * node is rendered in place of data rows; while loading, any prior rows are kept.
 */
export function DataTable<Row>({ columns, rows, loading, empty, getRowKey }: DataTableProps<Row>) {
  const showEmpty = !loading && rows.length === 0;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-3 font-medium",
                    col.align === "right" ? "text-right" : "text-left",
                    col.className,
                  )}
                  aria-sort="none"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showEmpty
              ? empty
              : rows.map((row) => (
                  <tr key={getRowKey(row)} className="border-b border-border/50 hover:bg-muted/20 transition">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-4 py-3",
                          col.align === "right" && "text-right",
                          col.className,
                        )}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
