# Task 08 — Orders: Admin Notes + Print/Invoice View

**Priority:** P2  
**Effort:** ~4h  
**Files:** `artifacts/store/src/pages/admin/OrderDetailPage.tsx`, `artifacts/api-server/src/routes/admin.ts`

---

## Problem

Couriers and logistics staff need to print a physical delivery slip. Currently there's no printable view. Admin notes (internal comments not visible to customers) are also missing — useful for flagging payment issues, special delivery instructions, or fraud concerns.

---

## Implementation Plan

### Part A — Admin Notes

#### 1. Add `admin_notes` column to the `orders` table

**Supabase migration:**
```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_notes text;
```

#### 2. Add PATCH endpoint

**File:** `artifacts/api-server/src/routes/admin.ts`

```typescript
router.patch("/admin/orders/:id/notes", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const { notes } = req.body;
  if (typeof notes !== "string") {
    res.status(400).json({ error: "notes must be a string" });
    return;
  }

  await (ctx.admin as any)
    .from("orders")
    .update({ admin_notes: notes.trim() || null })
    .eq("id", req.params.id);

  await (ctx.admin as any).from("audit_log").insert({
    actor_id: ctx.user.id,
    action: "update_order_notes",
    entity: "order",
    entity_id: req.params.id,
    changes: { admin_notes: notes },
  });

  res.json({ success: true });
});
```

#### 3. Add notes section to `OrderDetailPage.tsx`

Place it between the "Update Status" card and the WhatsApp log:

```tsx
// State
const [adminNotes, setAdminNotes] = useState(order.admin_notes ?? "");
const [notesSaving, setNotesSaving] = useState(false);
const [notesSaved, setNotesSaved] = useState(false);

const handleSaveNotes = async () => {
  setNotesSaving(true);
  await adminFetch(apiUrl(`/admin/orders/${id}/notes`), {
    method: "PATCH",
    body: JSON.stringify({ notes: adminNotes }),
  });
  setNotesSaving(false);
  setNotesSaved(true);
  setTimeout(() => setNotesSaved(false), 2000);
};
```

```tsx
<div className="bg-card border border-border rounded-xl p-5 space-y-3">
  <h2 className="font-semibold text-sm">Admin Notes (internal)</h2>
  <p className="text-xs text-muted-foreground">Not visible to the customer.</p>
  <textarea
    value={adminNotes}
    onChange={(e) => setAdminNotes(e.target.value)}
    rows={3}
    placeholder="Add internal notes about this order…"
    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
  />
  <button
    onClick={handleSaveNotes}
    disabled={notesSaving}
    className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition disabled:opacity-50"
  >
    {notesSaving ? "Saving…" : notesSaved ? "✓ Saved" : "Save Notes"}
  </button>
</div>
```

---

### Part B — Print/Invoice View

#### 1. Add a "Print" button to `OrderDetailPage.tsx`

```tsx
import { Printer } from "lucide-react";

<button
  onClick={() => window.print()}
  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition"
>
  <Printer size={14} /> Print Invoice
</button>
```

#### 2. Add print-specific CSS

**File:** `artifacts/store/src/index.css` (or a scoped `<style>` block)

```css
@media print {
  /* Hide admin layout sidebar and navigation */
  aside,
  nav,
  button,
  .no-print {
    display: none !important;
  }

  /* Show only the print content */
  .print-only {
    display: block !important;
  }

  body {
    background: white !important;
    color: black !important;
  }

  /* Break pages sensibly */
  .bg-card {
    border: 1px solid #ccc !important;
    box-shadow: none !important;
    page-break-inside: avoid;
  }
}
```

#### 3. Add a print-optimized header to the order detail

Wrap the order content with a `print-friendly` section that includes the store name and order date:

```tsx
{/* Print header — hidden on screen, shown when printing */}
<div className="hidden print:block mb-6 border-b pb-4">
  <h1 className="text-xl font-bold">İlk Electronics</h1>
  <p className="text-sm text-gray-500">Çatdırılma qaiməsi — {new Date(order.created_at).toLocaleDateString("az-AZ")}</p>
</div>
```

Use Tailwind's `print:` variant for print-specific visibility.

#### 4. Ensure all order sections have `no-print` on action buttons

Add `className="no-print"` to:
- Status update section
- WhatsApp notification section  
- Admin notes save button
- Print button itself

---

## Database Migration Required

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_notes text;
```

Run via Supabase SQL editor or `mcp_supabase_apply_migration`.

---

## Files Changed
- `artifacts/api-server/src/routes/admin.ts` — `PATCH /admin/orders/:id/notes`
- `artifacts/store/src/pages/admin/OrderDetailPage.tsx` — notes section + print button
- `artifacts/store/src/index.css` — print styles
- Supabase `orders` table — add `admin_notes` column
