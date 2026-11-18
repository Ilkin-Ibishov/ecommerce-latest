# Task 07 — Orders: CSV Export

**Priority:** P2  
**Effort:** ~3h  
**Files:** `artifacts/store/src/pages/admin/OrdersPage.tsx`, `artifacts/api-server/src/routes/admin.ts`

---

## Problem

The logistics team needs to export orders for the day/week to process deliveries. Currently they must manually copy data from the table. A CSV download solves this with no external tooling.

---

## Implementation Plan

### 1. Add export endpoint to the API

**File:** `artifacts/api-server/src/routes/admin.ts`

```typescript
router.get("/admin/orders/export", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const { status, from, to } = req.query as Record<string, string>;

  let query = (ctx.admin as any)
    .from("orders")
    .select("id, status, total_azn, discount_azn, customer_name, customer_phone, delivery_address, notes, created_at")
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", new Date(from).toISOString());
  if (to) query = query.lte("created_at", new Date(to).toISOString());

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  const orders = data ?? [];

  // Build CSV
  const headers = ["Order ID", "Status", "Customer Name", "Phone", "Address", "Notes", "Total (AZN)", "Discount (AZN)", "Date"];
  const rows = orders.map((o: any) => [
    o.id.slice(0, 8).toUpperCase(),
    o.status,
    `"${(o.customer_name ?? "").replace(/"/g, '""')}"`,
    o.customer_phone,
    `"${(o.delivery_address ?? "").replace(/"/g, '""')}"`,
    `"${(o.notes ?? "").replace(/"/g, '""')}"`,
    Number(o.total_azn).toFixed(2),
    Number(o.discount_azn).toFixed(2),
    new Date(o.created_at).toLocaleString("az-AZ"),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\uFEFF" + csv); // BOM prefix for Excel UTF-8 compatibility
});
```

> The `\uFEFF` BOM (Byte Order Mark) prefix is critical — Excel on Windows won't render UTF-8 correctly (Azerbaijani characters) without it.

### 2. Add export button to the orders list UI

**File:** `artifacts/store/src/pages/admin/OrdersPage.tsx`

Add a "Export CSV" button in the header row. It should respect the current status filter:

```tsx
import { Download } from "lucide-react";
import { adminFetch } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";

const handleExport = async () => {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  // Optional: pass from/to if date range is implemented (Task 06)

  const res = await adminFetch(`${apiUrl("/admin/orders/export")}?${params.toString()}`);
  if (!res.ok) return;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
```

```tsx
{/* In the header row */}
<div className="flex items-center gap-3">
  <h1 className="text-2xl font-bold">Orders</h1>
  <span className="text-sm text-muted-foreground">{count} total</span>
  <button
    onClick={handleExport}
    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition"
  >
    <Download size={14} /> Export CSV
  </button>
</div>
```

### 3. Include order items in the export (optional enhancement)

A separate "detailed export" could join `order_items` and produce one row per line item. This is useful for COGS analysis but adds complexity. Recommend deferring to a follow-up.

---

## CSV Column Specification

| Column | Source | Notes |
|--------|--------|-------|
| Order ID | `id.slice(0,8).toUpperCase()` | Short form for readability |
| Status | `status` | Raw enum value |
| Customer Name | `customer_name` | |
| Phone | `customer_phone` | |
| Address | `delivery_address` | Quoted for commas |
| Notes | `notes` | Quoted, may be empty |
| Total (AZN) | `total_azn` | 2 decimal places |
| Discount (AZN) | `discount_azn` | 2 decimal places |
| Date | `created_at` | `az-AZ` locale format |

---

## Files Changed
- `artifacts/api-server/src/routes/admin.ts` — `GET /admin/orders/export`
- `artifacts/store/src/pages/admin/OrdersPage.tsx` — export button + download handler
