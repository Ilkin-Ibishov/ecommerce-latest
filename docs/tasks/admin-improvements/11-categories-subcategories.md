# Task 11 — Categories: Subcategory Management

**Priority:** P2  
**Effort:** ~4h  
**File:** `artifacts/store/src/pages/admin/CategoriesPage.tsx`, `artifacts/api-server/src/routes/admin.ts`

---

## Problem

The database has a `parent_id` column on `categories` supporting a two-level hierarchy (root → subcategory). The storefront uses subcategories for navigation. However, the admin UI only shows and manages root categories. Subcategories cannot be created, edited, or deleted through the admin panel — they must be done directly in Supabase SQL editor.

---

## Current Data Model

```
categories
├── id (uuid)
├── slug (text, unique)
├── icon_url (text, nullable)
└── parent_id (uuid, nullable → references categories.id)
```

A root category has `parent_id = null`. A subcategory has `parent_id` set to a root category's `id`.

---

## Implementation Plan

### 1. Update the data fetch to show the full hierarchy

```typescript
useEffect(() => {
  const supabase = createClient();
  (supabase as any)
    .from("categories")
    .select("*, category_translations(*), subcategories:categories!parent_id(id, slug, category_translations(*))")
    .is("parent_id", null)
    .order("id")
    .then(({ data }: any) => setCategories(data ?? []));
}, []);
```

### 2. Expand the table to show subcategories inline

Replace the flat table with an accordion-style layout:

```tsx
{categories.map((cat) => {
  const subs = cat.subcategories ?? [];
  const title = getTitle(cat.category_translations, "az");
  return (
    <React.Fragment key={cat.id}>
      {/* Root category row */}
      <tr className="border-b border-border/50 bg-muted/10 hover:bg-muted/20">
        <td className="px-4 py-3 font-semibold flex items-center gap-2">
          {cat.icon_url && <img src={cat.icon_url} alt="" className="w-5 h-5 rounded" />}
          {title}
          <span className="text-xs text-muted-foreground font-normal">
            ({subs.length} subcategories)
          </span>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{cat.slug}</td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => openAddSub(cat)} title="Add subcategory"
              className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition">
              <Plus size={13} />
            </button>
            <button onClick={() => openEdit(cat)} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition"><Pencil size={13} /></button>
            <button onClick={() => handleDelete(cat.id)} className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition"><Trash2 size={13} /></button>
          </div>
        </td>
      </tr>

      {/* Subcategory rows */}
      {subs.map((sub: any) => {
        const subTitle = getTitle(sub.category_translations, "az");
        return (
          <tr key={sub.id} className="border-b border-border/40 hover:bg-muted/10">
            <td className="px-4 py-2 pl-10 text-sm text-muted-foreground flex items-center gap-1.5">
              <span className="text-muted-foreground/40">└</span>
              {subTitle}
            </td>
            <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{sub.slug}</td>
            <td className="px-4 py-2">
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => openEditSub(sub, cat.id)} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition"><Pencil size={13} /></button>
                <button onClick={() => handleDelete(sub.id)} className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition"><Trash2 size={13} /></button>
              </div>
            </td>
          </tr>
        );
      })}
    </React.Fragment>
  );
})}
```

### 3. Update the form to support subcategory creation

Add `parentId` to the form state:

```typescript
const [form, setForm] = useState({
  slug: "",
  icon_url: "",
  parent_id: null as string | null,
  translations: LANGS.map((lang_code) => ({ lang_code, title: "" })),
});

// When opening "Add subcategory":
const openAddSub = (parent: Category) => {
  setEditing(null);
  setForm({ slug: "", icon_url: "", parent_id: parent.id, translations: LANGS.map((l) => ({ lang_code: l, title: "" })) });
  setShowForm(true);
};
```

In the form UI, show the parent category name when `form.parent_id` is set:

```tsx
{form.parent_id && (
  <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
    📁 Adding subcategory under: <strong>{categories.find((c) => c.id === form.parent_id)?.category_translations.find((t) => t.lang_code === "az")?.title}</strong>
  </p>
)}
```

### 4. Update `handleSave` to pass `parent_id`

```typescript
const body = {
  slug: form.slug,
  icon_url: form.icon_url || null,
  parent_id: form.parent_id || null, // ← add this
  translations: form.translations.filter((t) => t.title.trim()),
};
```

The `POST /admin/categories` and `PATCH /admin/categories/:id` routes already accept `parent_id` in their body — no backend change needed.

### 5. Helper function for getting translated titles

```typescript
function getTitle(translations: { lang_code: string; title: string }[], lang: string): string {
  return translations.find((t) => t.lang_code === lang)?.title
    ?? translations[0]?.title
    ?? "Untitled";
}
```

---

## Files Changed
- `artifacts/store/src/pages/admin/CategoriesPage.tsx` — subcategory rows, add-sub button, form parent_id
- No backend changes needed (routes already support `parent_id`)
