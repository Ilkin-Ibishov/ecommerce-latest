import { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { useAdminList } from "@/lib/hooks/useAdminList";
import { useI18n } from "@/lib/i18n/context";
import { DataTable } from "@/components/admin/DataTable";
import { Pagination } from "@/components/admin/Pagination";
import { TableEmptyState } from "@/components/admin/TableEmptyState";
import { SearchInput } from "@/components/admin/SearchInput";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { AddStaffModal } from "@/components/admin/AddStaffModal";
import { userErrorKey } from "@/components/admin/user-error-key";
import { type AdminUser, createUsersColumns } from "@/components/admin/UserRoleControl";

export default function AdminUsersPage() {
  const { t } = useI18n();
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [roleFilter, setRoleFilter] = useState("all");
  const [callerId, setCallerId] = useState<string | null>(null);
  const [roleOverrides, setRoleOverrides] = useState<Record<string, "admin" | "staff" | "customer">>({});
  const [roleSaving, setRoleSaving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { confirm, dialogProps } = useConfirm();

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setCallerId(data.user?.id ?? null));
  }, []);

  const fetcher = useCallback(
    async (args: { offset: number; limit: number; search: string; signal: AbortSignal }) => {
      const p = new URLSearchParams({ page: String(args.offset / args.limit + 1) });
      if (args.search) p.set("q", args.search);
      if (roleFilter !== "all") p.set("role", roleFilter);
      const res = await adminFetch(`${apiUrl("/admin/users")}?${p.toString()}`, { signal: args.signal });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      return { rows: (data.users ?? []) as AdminUser[], count: (data.total ?? 0) as number };
    },
    [roleFilter, refreshKey],
  );

  const { rows: users, count, loading, page, totalPages, search, searchInput, setSearchInput } =
    useAdminList<AdminUser>({ fetcher, basePath: "/admin/users", pageSize: 30 });

  useEffect(() => { setRoleOverrides({}); }, [users]);

  const handleRoleChange = (u: AdminUser, newRole: "admin" | "staff" | "customer") => {
    if (newRole === (roleOverrides[u.id] ?? u.role)) return;
    setActionError(null);
    const roleLabel = t(newRole === "admin" ? "Admin.Users.roleAdmin" : newRole === "staff" ? "Admin.Users.roleStaff" : "Admin.Users.roleCustomer");
    confirm({
      title: t("Admin.Users.changeRoleTitle"),
      message: t("Admin.Users.changeRoleMessage").replace("{name}", u.full_name ?? u.phone).replace("{role}", roleLabel),
      onConfirm: async () => {
        setRoleSaving(u.id);
        const res = await adminFetch(apiUrl(`/admin/users/${u.id}/role`), { method: "PATCH", body: JSON.stringify({ role: newRole }) });
        if (res.ok) setRoleOverrides((prev) => ({ ...prev, [u.id]: newRole }));
        else {
          const data = await res.json().catch(() => ({}));
          setActionError(t(userErrorKey(data.error)));
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

  const columns = useMemo(
    () => createUsersColumns({ t, callerId, roleOverrides, roleSaving, onRoleChange: handleRoleChange }),
    [t, callerId, roleOverrides, roleSaving],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("Admin.Users.title")}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {search ? t("Admin.Users.resultCount").replace("{count}", String(count)).replace("{query}", search) : t("Admin.Users.registeredCount").replace("{count}", String(count))}
          </p>
        </div>
        <button type="button" onClick={() => setAddStaffOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold transition shadow-sm">
          <UserPlus size={14} />{t("Admin.Users.addStaff")}
        </button>
      </div>
      {actionError && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-xs p-3 rounded-lg flex items-center justify-between">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="text-xs underline ml-2">✕</button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex-1"><SearchInput value={searchInput} onChange={setSearchInput} placeholder={t("Admin.Users.searchPlaceholder")} debounceMs={0} /></div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label={t("Admin.Users.filterRole")} className="h-9 px-3 text-xs rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
          <option value="all">{t("Admin.Users.allRoles")}</option>
          <option value="admin">{t("Admin.Users.roleAdmin")}</option>
          <option value="staff">{t("Admin.Users.roleStaff")}</option>
          <option value="customer">{t("Admin.Users.roleCustomer")}</option>
        </select>
      </div>
      <DataTable<AdminUser> columns={columns} rows={users} loading={loading} getRowKey={(u) => u.id} empty={<TableEmptyState colSpan={5} message={search ? t("Admin.Users.emptySearchState").replace("{query}", search) : t("Admin.Users.emptyState")} />} />
      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
      <ConfirmDialog {...dialogProps} confirmLabel={t("Admin.Common.confirm")} cancelLabel={t("Admin.Common.cancel")} />
      <AddStaffModal open={addStaffOpen} onClose={() => setAddStaffOpen(false)} onCreated={() => setRefreshKey((k) => k + 1)} />
    </div>
  );
}
