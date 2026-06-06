import { useEffect, useState, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Search, X, ShieldCheck, User } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";

interface AdminUser {
  id: string;
  phone: string;
  full_name: string | null;
  role: "admin" | "customer";
  created_at: string;
  order_count: number;
}

export default function AdminUsersPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));

  const [searchInput, setSearchInput] = useState(params.get("q") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(params.get("q") ?? "");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [roleSaving, setRoleSaving] = useState<string | null>(null);

  const PAGE_SIZE = 30;

  // Debounce search 350ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Sync search to URL
  useEffect(() => {
    const p = new URLSearchParams();
    if (debouncedSearch) p.set("q", debouncedSearch);
    navigate(`/admin/users${p.toString() ? `?${p.toString()}` : ""}`, { replace: true });
  }, [debouncedSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    p.set("page", String(page));
    if (debouncedSearch) p.set("q", debouncedSearch);
    const res = await adminFetch(`${apiUrl("/admin/users")}?${p.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [page, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const handleRoleToggle = async (user: AdminUser) => {
    const newRole = user.role === "admin" ? "customer" : "admin";
    const confirm_ = window.confirm(
      `Change ${user.full_name ?? user.phone} to ${newRole}?`
    );
    if (!confirm_) return;
    setRoleSaving(user.id);
    const res = await adminFetch(apiUrl(`/admin/users/${user.id}/role`), {
      method: "PATCH",
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: newRole } : u));
    }
    setRoleSaving(null);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const buildPageHref = (p: number) => {
    const ps = new URLSearchParams();
    if (p > 1) ps.set("page", String(p));
    if (debouncedSearch) ps.set("q", debouncedSearch);
    return `/admin/users${ps.toString() ? `?${ps.toString()}` : ""}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Customers</h1>
        <span className="text-sm text-muted-foreground">
          {debouncedSearch
            ? `${total} result${total !== 1 ? "s" : ""} for "${debouncedSearch}"`
            : `${total} registered`}
        </span>
      </div>

      {/* Search */}
      <div className="relative w-64">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name or phone…"
          className="pl-8 pr-8 py-1.5 rounded-lg border border-border bg-background text-sm w-full focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {searchInput && (
          <button
            onClick={() => setSearchInput("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-left px-4 py-3 font-medium">Phone</th>
                <th className="text-right px-4 py-3 font-medium">Orders</th>
                <th className="text-left px-4 py-3 font-medium">Joined</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  {debouncedSearch ? `No customers found for "${debouncedSearch}"` : "No customers registered yet."}
                </td></tr>
              ) : users.map((u) => (
                <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                        {u.role === "admin"
                          ? <ShieldCheck size={14} className="text-purple-400" />
                          : <User size={14} className="text-muted-foreground" />}
                      </div>
                      <div>
                        <div className="font-medium">{u.full_name ?? <span className="text-muted-foreground italic">No name</span>}</div>
                        <div className="text-xs text-muted-foreground font-mono">{u.id.slice(0, 8)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{u.phone}</td>
                  <td className="px-4 py-3 text-right">
                    {u.order_count > 0 ? (
                      <Link
                        href={`/admin/orders?q=${encodeURIComponent(u.phone)}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {u.order_count}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.role === "admin"
                        ? "bg-purple-500/20 text-purple-400"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRoleToggle(u)}
                      disabled={roleSaving === u.id}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition disabled:opacity-50 ${
                        u.role === "admin"
                          ? "bg-muted text-muted-foreground hover:bg-muted/70"
                          : "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                      }`}
                    >
                      {roleSaving === u.id ? "…" : u.role === "admin" ? "Demote" : "Make Admin"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {page > 1 && (
            <Link href={buildPageHref(page - 1)} className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-sm text-muted-foreground transition">
              ← Prev
            </Link>
          )}
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const p = totalPages <= 7 ? i + 1 : Math.max(1, Math.min(page - 3, totalPages - 6)) + i;
            return (
              <Link key={p} href={buildPageHref(p)}
                className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm transition ${
                  p === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted text-muted-foreground"
                }`}
              >
                {p}
              </Link>
            );
          })}
          {page < totalPages && (
            <Link href={buildPageHref(page + 1)} className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-sm text-muted-foreground transition">
              Next →
            </Link>
          )}
          <span className="text-xs text-muted-foreground ml-2">Page {page} of {totalPages}</span>
        </div>
      )}
    </div>
  );
}
