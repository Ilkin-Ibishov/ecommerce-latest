import { Link } from "wouter";
import { ShieldCheck, UserCheck, User } from "lucide-react";
import type { Column } from "@/components/admin/DataTable";
import { useI18n } from "@/lib/i18n/context";

export interface AdminUser {
  id: string;
  phone: string;
  full_name: string | null;
  role: "admin" | "staff" | "customer";
  created_at: string;
  order_count: number;
}

export interface UserRoleControlProps {
  userId: string;
  role: "admin" | "staff" | "customer";
  callerId: string | null;
  saving: boolean;
  onChangeRole: (newRole: "admin" | "staff" | "customer") => void;
}

export function UserRoleBadge({ role }: { role: "admin" | "staff" | "customer" }) {
  const { t } = useI18n();
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
}

export function UserRoleControl({
  userId,
  role,
  callerId,
  saving,
  onChangeRole,
}: UserRoleControlProps) {
  const { t } = useI18n();
  const isSelf = callerId === userId;

  return (
    <div className="flex items-center justify-end gap-1.5">
      <select
        value={role}
        disabled={saving || isSelf}
        title={isSelf ? t("Admin.Users.cannotDemoteSelf") : undefined}
        onChange={(e) => onChangeRole(e.target.value as "admin" | "staff" | "customer")}
        className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border bg-card text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={t("Admin.Users.changeRole")}
      >
        <option value="customer">{t("Admin.Users.roleCustomer")}</option>
        <option value="staff">{t("Admin.Users.roleStaff")}</option>
        <option value="admin">{t("Admin.Users.roleAdmin")}</option>
      </select>
      {isSelf && (
        <span
          className="text-[11px] text-muted-foreground italic select-none"
          title={t("Admin.Users.cannotDemoteSelf")}
        >
          ({t("Admin.Users.you")})
        </span>
      )}
      {saving && <span className="text-xs text-muted-foreground animate-pulse">…</span>}
    </div>
  );
}

export function createUsersColumns(opts: {
  t: (k: any) => string;
  callerId: string | null;
  roleOverrides: Record<string, "admin" | "staff" | "customer">;
  roleSaving: string | null;
  onRoleChange: (u: AdminUser, r: "admin" | "staff" | "customer") => void;
}): Column<AdminUser>[] {
  const { t, callerId, roleOverrides, roleSaving, onRoleChange } = opts;
  return [
    {
      key: "customer",
      header: t("Admin.Users.columnCustomer"),
      cell: (u) => (
        <div>
          <div className="font-medium text-foreground">{u.full_name || t("Admin.Users.noName")}</div>
          <div className="text-xs text-muted-foreground font-mono">{u.phone}</div>
        </div>
      ),
    },
    {
      key: "orders",
      header: t("Admin.Users.columnOrders"),
      align: "right",
      cell: (u) => u.order_count > 0 ? (
        <Link href={`/admin/orders?q=${encodeURIComponent(u.phone)}`} className="text-primary hover:underline font-medium">
          {u.order_count}
        </Link>
      ) : <span className="text-muted-foreground">0</span>,
    },
    {
      key: "joined",
      header: t("Admin.Users.columnJoined"),
      className: "text-xs text-muted-foreground",
      cell: (u) => new Date(u.created_at).toLocaleDateString(),
    },
    {
      key: "role",
      header: t("Admin.Users.columnRole"),
      cell: (u) => <UserRoleBadge role={roleOverrides[u.id] ?? u.role} />,
    },
    {
      key: "actions",
      header: t("Admin.Users.columnActions"),
      align: "right",
      cell: (u) => (
        <UserRoleControl
          userId={u.id}
          role={roleOverrides[u.id] ?? u.role}
          callerId={callerId}
          saving={roleSaving === u.id}
          onChangeRole={(r) => onRoleChange(u, r)}
        />
      ),
    },
  ];
}
