import { DataTable, type Column } from "@/components/admin/DataTable";
import { TableEmptyState } from "@/components/admin/TableEmptyState";
import { Pagination } from "@/components/admin/Pagination";
import { Router } from "wouter";

/**
 * Playwright Component Testing serializes function props across the Node↔browser
 * boundary as async, fire-and-forget callbacks. That works for event handlers
 * (onSort/onChange) but NOT for synchronous render functions that must return a
 * value during render (DataTable's `column.cell`/`getRowKey`, Pagination's
 * `buildHref`). These harness components run entirely inside the browser bundle,
 * so they build those render functions natively and expose only plain,
 * serializable props (data, page, totalPages) to the spec.
 */

export interface HarnessRow {
  id: string;
  name: string;
  price: number;
}

export function DataTableHarness({ rows, loading }: { rows: HarnessRow[]; loading: boolean }) {
  const columns: Column<HarnessRow>[] = [
    { key: "name", header: "Name", cell: (r) => r.name },
    { key: "price", header: "Price", align: "right", cell: (r) => `$${r.price}` },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      loading={loading}
      empty={<TableEmptyState message="No results" colSpan={columns.length} />}
      getRowKey={(r) => r.id}
    />
  );
}

export function PaginationHarness({
  page,
  totalPages,
  hrefBase = "/admin/orders/",
}: {
  page: number;
  totalPages: number;
  hrefBase?: string;
}) {
  // Pagination uses wouter <Link>, so it must be mounted inside a <Router>.
  return (
    <Router>
      <Pagination page={page} totalPages={totalPages} buildHref={(p) => `${hrefBase}${p}`} />
    </Router>
  );
}
