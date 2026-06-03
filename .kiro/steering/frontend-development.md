---
inclusion: fileMatch
fileMatchPattern: "**/store/**"
---

# Frontend (Store) Development Guide

## Structure

```
artifacts/store/src/
├── App.tsx                    # Root: providers, router
├── main.tsx                   # Entry point
├── index.css                  # Tailwind imports
├── components/
│   ├── ui/                    # shadcn/ui primitives (Button, Dialog, etc.)
│   ├── storefront/            # Customer-facing components (Header, Footer, ProductCard)
│   └── auth/                  # Auth-related components
├── pages/
│   ├── storefront/            # Customer pages (HomePage, ProductsPage, etc.)
│   └── admin/                 # Admin pages (DashboardPage, ProductsPage, etc.)
├── lib/
│   ├── api.ts                 # apiUrl() helper
│   ├── utils.ts               # cn() utility
│   ├── admin-fetch.ts         # Admin API fetch wrapper
│   ├── cart/context.tsx        # Cart React context
│   ├── i18n/context.tsx        # I18n React context
│   ├── i18n/messages.ts        # Translation strings
│   ├── supabase/              # Supabase client setup
│   └── hooks/                 # Custom hooks
└── hooks/                     # Additional hooks
```

## Adding a New Page

### Storefront Page
1. Create `artifacts/store/src/pages/storefront/{PageName}.tsx`
2. Component receives `locale` prop: `function MyPage({ locale }: { locale: string })`
3. Add route in `App.tsx` inside `StorefrontRoutes`:
   ```tsx
   <Route path={`/${locale}/my-path`}>{() => <MyPage locale={locale} />}</Route>
   ```

### Admin Page
1. Create `artifacts/store/src/pages/admin/{PageName}.tsx`
2. Add route in `App.tsx` inside `AdminRoutes`:
   ```tsx
   <Route path="/admin/my-path" component={MyPage} />
   ```

## Adding a New UI Component

Use the shadcn/ui pattern:
1. Create in `artifacts/store/src/components/ui/{component}.tsx`
2. Use Radix UI primitive as base
3. Style with Tailwind + CVA for variants
4. Export from the file directly (no barrel exports)

## Data Fetching

```tsx
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

// GET request
const { data, isLoading } = useQuery({
  queryKey: ["products", locale],
  queryFn: () => fetch(apiUrl(`/products?lang=${locale}`)).then(r => r.json()),
});

// POST/PUT/DELETE
const mutation = useMutation({
  mutationFn: (body) => fetch(apiUrl("/products"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json()),
});
```

## i18n Usage

```tsx
import { useI18n } from "@/lib/i18n/context";

function MyComponent() {
  const { t, locale } = useI18n();
  return <h1>{t("page.title")}</h1>;
}
```

All user-facing strings MUST use `t()`. Add new keys to `artifacts/store/src/lib/i18n/messages.ts` for all three locales (az, ru, en).

## Styling

- Use Tailwind utility classes directly
- Use `cn()` from `@/lib/utils` for conditional classes
- Mobile-first responsive design (`md:`, `lg:` breakpoints)
- Dark mode not currently implemented
