# Task 10 — Products: Quick Stock Adjustment + Duplicate Product

**Priority:** P2  
**Effort:** ~3h  
**Files:** `artifacts/store/src/pages/admin/ProductsPage.tsx`, `artifacts/api-server/src/routes/admin.ts`

---

## Problem

**Stock adjustment:** When a new shipment arrives, admins need to update stock for multiple products. Currently this requires opening the full edit form for each one (slow, error-prone).

**Duplicate:** Creating a new product variant (e.g., 128GB vs 256GB version) currently means filling out the entire form from scratch. A "Duplicate" action pre-fills all fields from an existing product.

---

## Part A — Quick Stock Adjustment

### 1. Add inline stock editing to `ProductsPage`

Replace the static stock cell with an editable input that saves on blur or Enter:

```tsx
function StockCell({ productId, initialStock, onSaved }: {
  productId: string;
  initialStock: number;
  onSaved: (id: string, newStock: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(initialStock));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const newStock = parseInt(value, 10);
    if (isNaN(newStock) || newStock < 0 || newStock === initialStock) {
      setValue(String(initialStock));
      setEditing(false);
      return;
    }
    setSaving(true);
    await adminFetch(apiUrl(`/admin/products/${productId}/stock`), {
      method: "PATCH",
      body: JSON.stringify({ stock: newStock }),
    });
    setSaving(false);
    setEditing(false);
    onSaved(productId, newStock);
  };

  if (editing) {
    return (
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setValue(String(initialStock)); setEditing(false); } }}
        className="w-16 px-2 py-1 rounded border border-primary bg-background text-sm text-right focus:outline-none"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`text-right font-medium hover:underline cursor-text ${
        initialStock === 0 ? "text-red-400" : initialStock < 5 ? "text-orange-400" : ""
      }`}
      title="Click to edit stock"
    >
      {saving ? "…" : initialStock}
    </button>
  );
}
```

Use it in the table:
```tsx
<td className="px-4 py-3 text-right">
  <StockCell
    productId={p.id}
    initialStock={p.stock}
    onSaved={(id, stock) =>
      setProducts((prev) => prev.map((x) => x.id === id ? { ...x, stock } : x))
    }
  />
</td>
```

### 2. Add stock PATCH endpoint

**File:** `artifacts/api-server/src/routes/admin.ts`

```typescript
router.patch("/admin/products/:id/stock", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { stock } = req.body;

  if (typeof stock !== "number" || stock < 0 || !Number.isInteger(stock)) {
    res.status(400).json({ error: "stock must be a non-negative integer" });
    return;
  }

  await (ctx.admin as any).from("products").update({ stock }).eq("id", rawId);
  await (ctx.admin as any).from("audit_log").insert({
    actor_id: ctx.user.id, action: "adjust_stock",
    entity: "product", entity_id: rawId,
    changes: { stock },
  });

  res.json({ success: true });
});
```

---

## Part B — Duplicate Product

### 1. Add Duplicate button to the products table actions column

```tsx
import { Copy } from "lucide-react";

<button
  onClick={() => handleDuplicate(p.id)}
  className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition"
  title="Duplicate product"
>
  <Copy size={14} />
</button>
```

### 2. Add duplicate endpoint

```typescript
router.post("/admin/products/:id/duplicate", async (req, res) => {
  const ctx = await requireAdmin(req);
  if (!ctx) { res.status(403).json({ error: "Forbidden" }); return; }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const admin = ctx.admin;

  // Fetch original product with all relations
  const [productRes, specsRes] = await Promise.all([
    (admin as any).from("products")
      .select("*, product_translations(*), product_images(*), product_categories(category_id)")
      .eq("id", rawId).single(),
    (admin as any).from("product_specs")
      .select("spec_key, spec_value, sort_order")
      .eq("product_id", rawId).order("sort_order"),
  ]);

  if (!productRes.data) { res.status(404).json({ error: "Product not found" }); return; }
  const src = productRes.data;

  // Create new product with modified slug/sku
  const newSlug = `${src.slug}-copy-${Date.now()}`;
  const newSku = src.sku ? `${src.sku}-COPY` : null;

  const { data: newProduct, error } = await (admin as any)
    .from("products")
    .insert({
      sku: newSku, slug: newSlug, price: src.price,
      stock: 0, // reset stock on duplicates
      is_featured: false, is_on_sale: src.is_on_sale,
      is_deal_of_day: false,
      sort_order: src.sort_order, brand: src.brand,
      original_price: src.original_price,
    })
    .select("id").single();

  if (error) { res.status(400).json({ error: error.message }); return; }

  // Copy relations
  if (src.product_translations?.length) {
    await (admin as any).from("product_translations").insert(
      src.product_translations.map((t: any) => ({
        product_id: newProduct.id,
        lang_code: t.lang_code,
        title: `${t.title} (copy)`, // mark as copy in title
        description: t.description,
      }))
    );
  }
  if (src.product_images?.length) {
    await (admin as any).from("product_images").insert(
      src.product_images.map((img: any, i: number) => ({
        product_id: newProduct.id, url: img.url,
        alt_text: img.alt_text, sort_order: i,
      }))
    );
  }
  if (src.product_categories?.length) {
    await (admin as any).from("product_categories").insert(
      src.product_categories.map((pc: any) => ({
        product_id: newProduct.id, category_id: pc.category_id,
      }))
    );
  }
  if (specsRes.data?.length) {
    await (admin as any).from("product_specs").insert(
      specsRes.data.map((s: any) => ({
        product_id: newProduct.id, spec_key: s.spec_key,
        spec_value: s.spec_value, sort_order: s.sort_order,
      }))
    );
  }

  await (admin as any).from("audit_log").insert({
    actor_id: ctx.user.id, action: "duplicate_product",
    entity: "product", entity_id: newProduct.id,
    changes: { source_id: rawId },
  });

  res.status(201).json({ id: newProduct.id });
});
```

### 3. Frontend handler

```typescript
const handleDuplicate = async (id: string) => {
  const res = await adminFetch(apiUrl(`/admin/products/${id}/duplicate`), { method: "POST" });
  const data = await res.json();
  if (data.id) {
    navigate(`/admin/products/${data.id}/edit`);
  }
};
```

This immediately opens the new duplicate in the edit form so the admin can fix the slug, title, and price.

---

## Files Changed
- `artifacts/store/src/pages/admin/ProductsPage.tsx` — `StockCell` component, duplicate button
- `artifacts/api-server/src/routes/admin.ts` — `PATCH /admin/products/:id/stock`, `POST /admin/products/:id/duplicate`
