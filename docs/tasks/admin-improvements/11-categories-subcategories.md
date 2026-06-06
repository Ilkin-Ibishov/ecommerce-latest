# Task 11 — Categories: Subcategory Management

**Priority:** P2  
**Effort:** ~3h  
**Files changed:** `CategoriesPage.tsx` only — no backend changes needed

---

## Verified Findings (from source analysis)

- `POST /admin/categories` and `PATCH /admin/categories/:id` in `admin.ts` already accept and persist `parent_id` ✅
- Current `CategoriesPage.tsx` query uses `.is("parent_id", null)` — only root categories fetched
- Current form state has no `parent_id` field
- `Category` interface has no `subcategories` field
- DB `categories` table has `parent_id uuid FK → categories.id` ✅

**No backend changes required.** Frontend-only implementation.

---

## Implementation

### 1. Extend types

```typescript
interface SubCategory {
  id: string;
  slug: string;
  category_translations: { lang_code: string; title: string }[];
}

interface Category {
  id: string;
  slug: string;
  icon_url: string | null;
  category_translations: { lang_code: string; title: string }[];
  subcategories?: SubCategory[]; // ← add
}
```

### 2. Update fetch query

```typescript
(supabase as any)
  .from("categories")
  .select("*, category_translations(*), subcategories:categories!parent_id(id, slug, category_translations(*))")
  .is("parent_id", null)
  .order("id")
```

### 3. Add `parent_id` to form state

```typescript
const EMPTY_FORM = {
  slug: "",
  icon_url: "",
  parent_id: null as string | null,  // ← add
  translations: LANGS.map((lang_code) => ({ lang_code, title: "" })),
};
```

Add `openAddSub` handler:
```typescript
const openAddSub = (parent: Category) => {
  setEditing(null);
  setForm({ ...EMPTY_FORM, parent_id: parent.id });
  setShowForm(true);
};
```

### 4. Include `parent_id` in save body

```typescript
const body = {
  slug: form.slug,
  icon_url: form.icon_url || null,
  parent_id: form.parent_id ?? null,  // ← add (already accepted by backend)
  translations: form.translations.filter((t) => t.title.trim()),
};
```

### 5. Form: show parent context when creating subcategory

```tsx
{form.parent_id && (
  <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
    📁 Adding subcategory under:{" "}
    <strong>
      {categories.find((c) => c.id === form.parent_id)
        ?.category_translations.find((t) => t.lang_code === "az")?.title}
    </strong>
  </p>
)}
```

### 6. Table: render subcategory rows inline using `React.Fragment`

Add helper:
```typescript
function getTitle(translations: { lang_code: string; title: string }[], lang = "az"): string {
  return translations.find((t) => t.lang_code === lang)?.title ?? translations[0]?.title ?? "Untitled";
}
```

Table structure — switch from flat rows to `React.Fragment` per category:
- Root row: icon + title + subcategory count badge, slug, actions (Edit | Delete | `+` Add Sub)
- Sub rows (indented `pl-10`, `└` prefix): sub title, slug, actions (Edit | Delete only — no further nesting)

### 7. Delete confirmation for root categories with subcategories

```typescript
const handleDelete = async (id: string) => {
  const cat = categories.find((c) => c.id === id);
  const subCount = cat?.subcategories?.length ?? 0;
  const msg = subCount > 0
    ? `Delete "${getTitle(cat!.category_translations)}" and its ${subCount} subcategory(s)?`
    : "Delete this category?";
  if (!confirm(msg)) return;
  // ... existing delete logic
};
```

---

## Files Changed
- `artifacts/store/src/pages/admin/CategoriesPage.tsx`
