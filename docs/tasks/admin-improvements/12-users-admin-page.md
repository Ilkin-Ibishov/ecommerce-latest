# Task 12 — Customers/Users Admin Page

**Priority:** P2  
**Effort:** ~6h  
**New file:** `artifacts/store/src/pages/admin/UsersPage.tsx`  
**API changes:** `artifacts/api-server/src/routes/admin.ts`

---

## Problem

There's no way to view registered customers through the admin panel. Admins can't:
- See how many users are registered and when they joined
- Look up a user's order history
- Promote a user to admin role (currently requires direct DB access)
- Ban or deactivate a problematic user

---

## Implementation Plan

### 1. Add backend endpoints

**File:** `artifacts/api-server/src/routes/admin.ts`

#### GET /admin/users — paginated user list with order counts

```typescript
router.get("/admin/users", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const pageSize = 30;
  const offset = (page - 1) * pageSize;
  const search = String(req.query.q ?? "").trim();

  let query = (ctx.admin as any)
    .from("users")
    .select("id, phone, full_name, role, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (search) {
    const term = `%${search}%`;
    query = query.or(`full_name.ilike.${term},phone.ilike.${term}`);
  }

  const { data: users, count, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Get order counts for all users in this page
  const userIds = (users ?? []).map((u: any) => u.id);
  let orderCounts: Record<string, number> = {};
  if (userIds.length > 0) {
    const { data: orders } = await (ctx.admin as any)
      .from("orders")
      .select("user_id")
      .in("user_id", userIds);
    (orders ?? []).forEach((o: any) => {
      orderCounts[o.user_id] = (orderCounts[o.user_id] ?? 0) + 1;
    });
  }

  const enriched = (users ?? []).map((u: any) => ({
    ...u,
    order_count: orderCounts[u.id] ?? 0,
  }));

  res.json({ users: enriched, total: count ?? 0, page, pageSize });
});
```

#### PATCH /admin/users/:id/role — change user role

```typescript
router.patch("/admin/users/:id/role", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const { role } = req.body;
  if (!["admin", "customer"].includes(role)) {
    res.status(400).json({ error: "role must be 'admin' or 'customer'" });
    return;
  }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Prevent self-demotion
  if (rawId === ctx.user.id && role !== "admin") {
    res.status(400).json({ error: "You cannot remove your own admin role" });
    return;
  }

  await (ctx.admin as any).from("users").update({ role }).eq("id", rawId);
  await (ctx.admin as any).from("audit_log").insert({
    actor_id: ctx.user.id, action: "change_user_role",
    entity: "user", entity_id: rawId,
    changes: { role },
  });

  res.json({ success: true });
});
```

#### GET /admin/users/:id/orders — user's order history

```typescript
router.get("/admin/users/:id/orders", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const { data: orders } = await (ctx.admin as any)
    .from("orders")
    .select("id, status, total_azn, created_at")
    .eq("user_id", rawId)
    .order("created_at", { ascending: false });

  res.json(orders ?? []);
});
```

### 2. Create `UsersPage.tsx`

```tsx
export default function AdminUsersPage() {
  // State: users[], total, page, search, loading
  // On mount: fetch /admin/users

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Customers</h1>
        <span className="text-sm text-muted-foreground">{total} registered</span>
      </div>

      {/* Search input */}
      <SearchInput value={search} onChange={setSearch} placeholder="Search by name or phone…" />

      {/* Users table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
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
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-4 py-3">
                  <div className="font-medium">{u.full_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground font-mono">{u.id.slice(0, 8)}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{u.phone}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/orders?q=${u.phone}`} className="text-primary hover:underline">
                    {u.order_count}
                  </Link>
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
                  <RoleToggleButton user={u} onToggle={handleRoleToggle} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Pagination page={page} total={total} pageSize={pageSize} />
    </div>
  );
}
```

### 3. Add the page to `AdminLayout.tsx` nav

```tsx
// In navItems array, add after Orders:
{ href: "/admin/users", label: "Customers", icon: Users },
```

Import `Users` from lucide-react.

### 4. Register the route in `App.tsx`

```tsx
// Inside AdminRoutes:
<Route path="/admin/users" component={AdminUsersPage} />
```

---

## Security Notes

- The role change endpoint prevents self-demotion to avoid lockout
- All operations are logged to the audit trail
- The endpoint returns the same data shape regardless of search to prevent user enumeration edge cases

---

## Files Changed
- `artifacts/store/src/pages/admin/UsersPage.tsx` — new file
- `artifacts/store/src/pages/admin/AdminLayout.tsx` — add Customers nav item
- `artifacts/store/src/App.tsx` — register route
- `artifacts/api-server/src/routes/admin.ts` — 3 new endpoints
