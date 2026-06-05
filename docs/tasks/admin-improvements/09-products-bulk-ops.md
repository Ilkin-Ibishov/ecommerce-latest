# Task 09 — Products: Bulk Operations

**Priority:** P2  
**Effort:** ~4h  
**Files:** `artifacts/store/src/pages/admin/ProductsPage.tsx`, `artifacts/api-server/src/routes/admin.ts`

---

## Problem

Admins routinely need to operate on many products at once — e.g., mark a batch of products as "On Sale" during a campaign, or delete old discontinued products. Doing this one-by-one through the edit form is extremely slow.

---

## Implementation Plan

### 1. Add checkbox selection state

```typescript
const [selected, setSelected] = useState<Set<string>>(new Set());
const allSelected = products.length > 0 && selected.size === products.length;

const toggleSelect = (id: string) => {
  setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
};

const toggleSelectAll = () => {
  setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
};
```

### 2. Add checkbox column to the table

Add a checkbox in the `<thead>` for select-all, and per-row checkboxes in `<tbody>`:

```tsx
{/* thead */}
<th className="px-4 py-3 w-8">
  <input
    type="checkbox"
    checked={allSelected}
    onChange={toggleSelectAll}
    className="w-4 h-4 cursor-pointer"
  />
</th>

{/* tbody row */}
<td className="px-4 py-3">
  <input
    type="checkbox"
    checked={selected.has(p.id)}
    onChange={() => toggleSelect(p.id)}
    className="w-4 h-4 cursor-pointer"
  />
</td>
```

### 3. Bulk action toolbar (appears when items are selected)

Show a floating action bar at the top of the table when `selected.size > 0`:

```tsx
{selected.size > 0 && (
  <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-xl text-sm">
    <span className="font-medium text-primary">{selected.size} selected</span>
    <div className="flex gap-2 ml-2">
      <BulkButton onClick={() => handleBulkFlag("is_featured", true)} label="Set Featured" />
      <BulkButton onClick={() => handleBulkFlag("is_featured", false)} label="Unset Featured" />
      <BulkButton onClick={() => handleBulkFlag("is_on_sale", true)} label="Set On Sale" />
      <BulkButton onClick={() => handleBulkFlag("is_on_sale", false)} label="Unset On Sale" />
      <BulkButton onClick={handleBulkDelete} label="Delete" destructive />
    </div>
    <button
      onClick={() => setSelected(new Set())}
      className="ml-auto text-muted-foreground hover:text-foreground"
    >
      <X size={14} />
    </button>
  </div>
)}
```

```tsx
function BulkButton({ onClick, label, destructive }: { onClick: () => void; label: string; destructive?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
        destructive
          ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      }`}
    >
      {label}
    </button>
  );
}
```

### 4. Add bulk API endpoints

**File:** `artifacts/api-server/src/routes/admin.ts`

```typescript
// Bulk flag update
router.patch("/admin/products/bulk-flag", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const { ids, field, value } = req.body as {
    ids: string[];
    field: "is_featured" | "is_on_sale" | "is_deal_of_day";
    value: boolean;
  };

  const VALID_FIELDS = ["is_featured", "is_on_sale", "is_deal_of_day"];
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array required" }); return;
  }
  if (!VALID_FIELDS.includes(field)) {
    res.status(400).json({ error: "Invalid field" }); return;
  }

  await (ctx.admin as any).from("products").update({ [field]: value }).in("id", ids);
  await (ctx.admin as any).from("audit_log").insert({
    actor_id: ctx.user.id, action: "bulk_flag_products",
    entity: "product", entity_id: null,
    changes: { ids, field, value },
  });

  res.json({ success: true, count: ids.length });
});

// Bulk delete
router.delete("/admin/products/bulk", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array required" }); return;
  }

  await (ctx.admin as any).from("products").delete().in("id", ids);
  await (ctx.admin as any).from("audit_log").insert({
    actor_id: ctx.user.id, action: "bulk_delete_products",
    entity: "product", entity_id: null,
    changes: { ids },
  });

  res.json({ success: true, count: ids.length });
});
```

### 5. Frontend handlers

```typescript
const handleBulkFlag = async (field: string, value: boolean) => {
  const ids = [...selected];
  await adminFetch(apiUrl("/admin/products/bulk-flag"), {
    method: "PATCH",
    body: JSON.stringify({ ids, field, value }),
  });
  // Update local state optimistically
  setProducts((prev) =>
    prev.map((p) => selected.has(p.id) ? { ...p, [field]: value } : p)
  );
  setSelected(new Set());
};

const handleBulkDelete = async () => {
  const ids = [...selected];
  if (!confirm(`Delete ${ids.length} products? This cannot be undone.`)) return;
  await adminFetch(apiUrl("/admin/products/bulk"), {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
  setProducts((prev) => prev.filter((p) => !selected.has(p.id)));
  setSelected(new Set());
};
```

### 6. Route ordering in Express

> **Important:** Express matches routes in order. The `/bulk-flag` and `/bulk` routes must be registered **before** the `/admin/products/:id` route (if one exists) to avoid `:id` capturing "bulk-flag" as a product ID.

---

## Files Changed
- `artifacts/store/src/pages/admin/ProductsPage.tsx` — checkboxes, selection state, bulk action bar
- `artifacts/api-server/src/routes/admin.ts` — `PATCH /admin/products/bulk-flag`, `DELETE /admin/products/bulk`
