import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ShieldCheck, User } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { useAdminList } from "@/lib/hooks/useAdminList";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { TableEmptyState } from "@/components/admin/TableEmptyState";
import { SearchInput } from "@/components/admin/SearchInput";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useConfirm } from "@/lib/hooks/useConfirm";

interface AdminUser {
  id: string;
  phone: string;
  full_name: string | null;
  role: "admin" | "customer";
  created_at: string;
  order_count: number;
}

const PAGE_SIZE = 30;

/**
 * Customers (admin users) list. The bespoke useState/useEffect/debounce/
 * buildHref/pagination blocks are replaced by `useAdminList` (URL-driven
 * pagination + 350 ms debounced search) + `<DataTable>`/`<Pagination>`/
 * `<TableEmptyState>` + the existing `<SearchInput>` (R6.4). The role-toggle
 * action, its `window.confirm` gate, optimistic role update, and `roleSaving`
 * spinner are preserved. Columns/labels/cell markup reproduce the prior
 * hand-rolled table (R6.3, R6.5, R6.6).
 */
export default function AdminUsersPage() {
  // Fetcher runs the existing /admin/users API query unchanged; the server
  // paginates by page (PAGE_SIZE 30) and returns { users, total }.
  const fetcher = useCallback(
    async (args: { offset: number; limit: number; search: string; signal: AbortSignal }) => {
      const p = new URLSearchParams();
      p.set("page", String(args.offset / args.limit + 1));
      if (args.search) p.set("q", args.search);
      const res = await adminFetch(`${apiUrl("/admin/users")}?${p.toString()}`, { signal: args.signal });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      return { rows: (data.users ?? []) as AdminUser[], count: (data.total ?? 0) as number };
    },
    [],
  );

  const { rows: users, count, loading, page, totalPages, search, searchInput, setSearchInput } =
    useAdminList<AdminUser>({ fetcher, basePath: "/admin/users", pageSize: PAGE_SIZE });

  // Optimistic role overrides: a successful toggle reflects immediately without
  // a refetch; overrides reset whenever the hook delivers a fresh page (matching
  // the prior load()-replaces-list behavior).
  const [roleOverrides, setRoleOverrides] = useState<Record<string, "admin" | "customer">>({});
  const [roleSaving, setRoleSaving] = useState<string | null>(null);
  useEffect(() => { setRoleOverrides({}); }, [users]);

  const { confirm, dialogProps } = useConfirm();

  const handleRoleToggle = (user: AdminUser) => {
    const current = roleOverrides[user.id] ?? user.role;
    const newRole = current === "admin" ? "customer" : "admin";
    confirm({
      title: "Change Role",
      message: `Change ${user.full_name ?? user.phone} to ${newRole}?`,
      onConfirm: async () => {
        setRoleSaving(user.id);
        const res = await adminFetch(apiUrl(`/admin/users/${user.id}/role`), {
          method: "PATCH",
          body: JSON.stringify({ role: newRole }),
        });
        if (res.ok) {
          setRoleOverrides((prev) => ({ ...prev, [user.id]: newRole }));
        }
        setRoleSaving(null);
      },
    });
  };

  const buildHref = (p: number) => {
    const ps = new URLSearchParams();
    if (p > 1) ps.set("page", String(p));
    if (search) ps.set("q", search);
    return `/admin/users${ps.toString() ? `?${ps.toString()}` : ""}`;
  };

  // Columns reference component state (effective role, roleSaving, handler), so
  // they are built per-render rather than at module scope.
  const columns: Column<AdminUser>[] = [
    {
      key: "customer",
      header: "Customer",
      align: "left",
      cell: (u) => {
        const role = roleOverrides[u.id] ?? u.role;
        return (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              {role === "admin"
                ? <ShieldCheck size={14} className="text-purple-400" />
                : <User size={14} className="text-muted-foreground" />}
            </div>
            <div>
              <div className="font-medium">{u.full_name ?? <span className="text-muted-foreground italic">No name</span>}</div>
              <div className="text-xs text-muted-foreground font-mono">{u.id.slice(0, 8)}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: "phone",
      header: "Phone",
      align: "left",
      className: "font-mono text-xs",
      cell: (u) => u.phone,
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      cell: (u) =>
        u.order_count > 0 ? (
          <Link
            href={`/admin/orders?q=${encodeURIComponent(u.phone)}`}
            className="text-primary hover:underline font-medium"
          >
            {u.order_count}
          </Link>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    {
      key: "joined",
      header: "Joined",
      align: "left",
      className: "text-xs text-muted-foreground",
      cell: (u) => new Date(u.created_at).toLocaleDateString(),
    },
    {
      key: "role",
      header: "Role",
      align: "left",
      cell: (u) => {
        const role = roleOverrides[u.id] ?? u.role;
        return (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            role === "admin"
              ? "bg-purple-500/20 text-purple-400"
              : "bg-muted text-muted-foreground"
          }`}>
            {role}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (u) => {
        const role = roleOverrides[u.id] ?? u.role;
        return (
          <button
            onClick={() => handleRoleToggle(u)}
            disabled={roleSaving === u.id}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition disabled:opacity-50 ${
              role === "admin"
                ? "bg-muted text-muted-foreground hover:bg-muted/70"
                : "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
            }`}
          >
            {roleSaving === u.id ? "…" : role === "admin" ? "Demote" : "Make Admin"}
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Customers</h1>
        <span className="text-sm text-muted-foreground">
          {search
            ? `${count} result${count !== 1 ? "s" : ""} for "${search}"`
            : `${count} registered`}
        </span>
      </div>

      {/* Search — debounce owned by useAdminList (350 ms); SearchInput forwards
          keystrokes immediately so the committed-search timing is preserved (R6.4). */}
      <SearchInput
        value={searchInput}
        onChange={setSearchInput}
        placeholder="Search by name or phone…"
        debounceMs={0}
      />

      <DataTable<AdminUser>
        columns={columns}
        rows={users}
        loading={loading}
        getRowKey={(u) => u.id}
        empty={
          <TableEmptyState
            colSpan={6}
            message={search ? `No customers found for "${search}"` : "No customers registered yet."}
          />
        }
      />

      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
