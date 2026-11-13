import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ShieldCheck, User, UserCheck, UserPlus } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { useAdminList } from "@/lib/hooks/useAdminList";
import { useI18n } from "@/lib/i18n/context";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { TableEmptyState } from "@/components/admin/TableEmptyState";
import { SearchInput } from "@/components/admin/SearchInput";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { AddStaffModal } from "@/components/admin/AddStaffModal";

interface AdminUser {
  id: string;
  phone: string;
  full_name: string | null;
  role: "admin" | "staff" | "customer";
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
  const { t } = useI18n();
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
    [refreshKey],
  );

  const { rows: users, count, loading, page, totalPages, search, searchInput, setSearchInput } =
    useAdminList<AdminUser>({ fetcher, basePath: "/admin/users", pageSize: PAGE_SIZE });

  // Optimistic role overrides: a successful toggle reflects immediately without
  // a refetch; overrides reset whenever the hook delivers a fresh page.
  const [roleOverrides, setRoleOverrides] = useState<Record<string, "admin" | "staff" | "customer">>({});
  const [roleSaving, setRoleSaving] = useState<string | null>(null);
  useEffect(() => { setRoleOverrides({}); }, [users]);

  const { confirm, dialogProps } = useConfirm();

  const handleRoleChange = (user: AdminUser, newRole: "admin" | "staff" | "customer") => {
    const current = roleOverrides[user.id] ?? user.role;
    if (newRole === current) return;
    const roleLabel =
      newRole === "admin"
        ? t("Admin.Users.roleAdmin")
        : newRole === "staff"
        ? t("Admin.Users.roleStaff")
        : t("Admin.Users.roleCustomer");

    confirm({
      title: t("Admin.Users.changeRoleTitle"),
      message: t("Admin.Users.changeRoleMessage")
        .replace("{name}", user.full_name ?? user.phone)
        .replace("{role}", roleLabel),
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
      header: t("Admin.Users.columnCustomer"),
      align: "left",
      cell: (u) => {
        const role = roleOverrides[u.id] ?? u.role;
        return (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              {role === "admin" ? (
                <ShieldCheck size={14} className="text-purple-400" />
              ) : role === "staff" ? (
                <UserCheck size={14} className="text-blue-400" />
              ) : (
                <User size={14} className="text-muted-foreground" />
              )}
            </div>
            <div>
              <div className="font-medium">{u.full_name ?? <span className="text-muted-foreground italic">{t("Admin.Users.noName")}</span>}</div>
              <div className="text-xs text-muted-foreground font-mono">{u.id.slice(0, 8)}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: "phone",
      header: t("Admin.Users.columnPhone"),
      align: "left",
      className: "font-mono text-xs",
      cell: (u) => u.phone,
    },
    {
      key: "orders",
      header: t("Admin.Users.columnOrders"),
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
      header: t("Admin.Users.columnJoined"),
      align: "left",
      className: "text-xs text-muted-foreground",
      cell: (u) => new Date(u.created_at).toLocaleDateString(),
    },
    {
      key: "role",
      header: t("Admin.Users.columnRole"),
      align: "left",
      cell: (u) => {
        const role = roleOverrides[u.id] ?? u.role;
        return (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
              role === "admin"
                ? "bg-purple-500/20 text-purple-400"
                : role === "staff"
                ? "bg-blue-500/20 text-blue-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {role === "admin" ? (
              <ShieldCheck size={13} className="shrink-0" />
            ) : role === "staff" ? (
              <UserCheck size={13} className="shrink-0" />
            ) : (
              <User size={13} className="shrink-0" />
            )}
            {role === "admin"
              ? t("Admin.Users.roleAdmin")
              : role === "staff"
              ? t("Admin.Users.roleStaff")
              : t("Admin.Users.roleCustomer")}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: t("Admin.Users.columnActions"),
      align: "right",
      cell: (u) => {
        const role = roleOverrides[u.id] ?? u.role;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <select
              value={role}
              disabled={roleSaving === u.id}
              onChange={(e) => handleRoleChange(u, e.target.value as "admin" | "staff" | "customer")}
              className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border bg-card text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              aria-label={t("Admin.Users.changeRole")}
            >
              <option value="customer">{t("Admin.Users.roleCustomer")}</option>
              <option value="staff">{t("Admin.Users.roleStaff")}</option>
              <option value="admin">{t("Admin.Users.roleAdmin")}</option>
            </select>
            {roleSaving === u.id && <span className="text-xs text-muted-foreground animate-pulse">…</span>}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("Admin.Users.title")}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {search
              ? t("Admin.Users.resultCount").replace("{count}", String(count)).replace("{query}", search)
              : t("Admin.Users.registeredCount").replace("{count}", String(count))}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddStaffOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold transition shadow-sm"
        >
          <UserPlus size={14} />
          {t("Admin.Users.addStaff")}
        </button>
      </div>

      {/* Search — debounce owned by useAdminList (350 ms); SearchInput forwards
          keystrokes immediately so the committed-search timing is preserved (R6.4). */}
      <SearchInput
        value={searchInput}
        onChange={setSearchInput}
        placeholder={t("Admin.Users.searchPlaceholder")}
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
            message={search ? t("Admin.Users.emptySearchState").replace("{query}", search) : t("Admin.Users.emptyState")}
          />
        }
      />

      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />

      <ConfirmDialog {...dialogProps} confirmLabel={t("Admin.Common.confirm")} cancelLabel={t("Admin.Common.cancel")} />

      <AddStaffModal
        open={addStaffOpen}
        onClose={() => setAddStaffOpen(false)}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
