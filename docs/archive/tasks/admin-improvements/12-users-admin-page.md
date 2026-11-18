# Task 12 — Customers/Users Admin Page

**Priority:** P2  
**Effort:** ~4h (reduced from 6h — no order drill-down, simpler scope)  
**New file:** `artifacts/store/src/pages/admin/UsersPage.tsx`

---

## Verified Findings (from source + DB analysis)

**DB `users` columns confirmed:** `id, phone, full_name, role, created_at`

⚠️ **`default_address` DOES NOT EXIST in the DB.** It is referenced in:
- `useProfile.ts` (line 8: `default_address: string | null`)
- `ProfilePage.tsx` (saves/reads it)
- `CheckoutPage.tsx` (pre-fills from profile)

This is a **pre-existing silent bug** — profile saves of address are failing in production. Task 12 must include the migration to fix it.

**`App.tsx` `AdminRoutes`** — imports and registers all admin pages. Pattern to follow:
```tsx
import AdminUsersPage from "@/pages/admin/UsersPage";
// ...
<Route path="/admin/users" component={AdminUsersPage} />
```

**`AdminLayout.tsx` navItems** — array pattern, add entry with lucide icon.

**`adminFetch`** from `@/lib/admin-fetch` — must be used for all admin API calls (adds auth header automatically).

**Orders table** has `user_id` FK — use to count per user. Order count links to `/admin/orders?q={phone}` (search already works from Sprint 1).

---

## Implementation

### Step 0 — DB Migration (fixes pre-existing ProfilePage bug)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_address text;
```

Run via `mcp_supabase_apply_migration` with name `add_default_address_to_users`.

### Step 1 — Backend endpoints in `admin.ts`

#### GET /admin/users

```typescript
router.get("/admin/users", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const pageSize = 30;
  const offset = (page - 1) * pageSize;
  const q = String(req.query.q ?? "").trim();

  let query = (ctx.admin as any)
    .from("users")
    .select("id, phone, full_name, role, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);

  const { data: users, count, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Fetch order counts for this page's users
  const userIds = (users ?? []).map((u: any) => u.id);
  const orderCounts: Record<string, number> = {};
  if (userIds.length > 0) {
    const { data: orders } = await (ctx.admin as any)
      .from("orders").select("user_id").in("user_id", userIds);
    (orders ?? []).forEach((o: any) => {
      orderCounts[o.user_id] = (orderCounts[o.user_id] ?? 0) + 1;
    });
  }

  res.json({
    users: (users ?? []).map((u: any) => ({ ...u, order_count: orderCounts[u.id] ?? 0 })),
    total: count ?? 0,
    page,
    pageSize,
  });
});
```

#### PATCH /admin/users/:id/role

```typescript
router.patch("/admin/users/:id/role", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const { role } = req.body;
  if (!["admin", "customer"].includes(role)) {
    res.status(400).json({ error: "role must be admin or customer" }); return;
  }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (rawId === ctx.user.id && role !== "admin") {
    res.status(400).json({ error: "Cannot remove your own admin role" }); return;
  }

  await (ctx.admin as any).from("users").update({ role }).eq("id", rawId);
  await (ctx.admin as any).from("audit_log").insert({
    actor_id: ctx.user.id, action: "change_user_role",
    entity: "user", entity_id: rawId, changes: { role },
  });

  res.json({ success: true });
});
```

### Step 2 — `UsersPage.tsx`

State: `users[]`, `total: number`, `page: number`, `searchInput: string`, `debouncedSearch: string`, `loading: boolean`

Data fetching:
```typescript
// adminFetch to /admin/users?q=...&page=...
// Debounce search 350ms (same pattern as OrdersPage)
```

Table columns: Customer (full_name + id prefix), Phone, Orders (count → link to `/admin/orders?q={phone}`), Joined, Role badge, Role toggle button

Role toggle:
```typescript
const handleRoleToggle = async (user: any) => {
  const newRole = user.role === "admin" ? "customer" : "admin";
  if (!confirm(`Change ${user.full_name ?? user.phone} to ${newRole}?`)) return;
  await adminFetch(apiUrl(`/admin/users/${user.id}/role`), {
    method: "PATCH",
    body: JSON.stringify({ role: newRole }),
  });
  setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: newRole } : u));
};
```

Pagination: same component pattern as OrdersPage.

### Step 3 — `AdminLayout.tsx`

Add to `navItems` array after Orders:
```typescript
import { Users } from "lucide-react";
// ...
{ href: "/admin/users", label: "Customers", icon: Users },
```

### Step 4 — `App.tsx`

```typescript
import AdminUsersPage from "@/pages/admin/UsersPage";
// Inside AdminRoutes:
<Route path="/admin/users" component={AdminUsersPage} />
```

---

## Files Changed
- Supabase migration: `add_default_address_to_users`
- `artifacts/api-server/src/routes/admin.ts` — 2 new endpoints
- `artifacts/store/src/pages/admin/UsersPage.tsx` — new file
- `artifacts/store/src/pages/admin/AdminLayout.tsx` — add Customers nav item
- `artifacts/store/src/App.tsx` — register route
