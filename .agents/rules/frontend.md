---
trigger: glob
globs: artifacts/store/**/*
description: Frontend standards, Wouter routing, React components, and i18n rules for storefront and admin UI
---

# Frontend (Store & Admin) Rules

## Architecture & Framework
- Framework: React with Vite, TypeScript, Tailwind CSS, Wouter routing, and TanStack React Query.
- Location: `artifacts/store/src/`
- Directory layout:
  - `components/ui/`: shadcn/ui primitives (Radix base, Tailwind + CVA).
  - `components/storefront/`: Customer-facing components (`ProductCard`, `Header`, `ProductGrid`).
  - `components/admin/`: Shared admin UI (`DataTable`, `Pagination`, `SearchInput`, `ConfirmDialog`).
  - `lib/i18n/`: Multilingual context and per-locale dictionaries (`az.ts`, `ru.ts`, `en.ts`).
  - `lib/queries/`: Centralized Supabase data fetching queries.

## Adding Routes
- **Storefront**: Route format is `/${locale}/<path>` in `App.tsx` (`StorefrontRoutes`). Components take `{ locale: string }`.
- **Admin**: Route format is `/admin/<path>` in `App.tsx` (`AdminRoutes`).

## i18n Discipline
- **Zero Hardcoded Strings**: All user-visible text in storefront and admin must use `t("key")`.
- When adding a translation key, it **must** be added to all 3 dictionary files: `az.ts`, `ru.ts`, and `en.ts`. The `i18n-consistency` test enforces identical key structures across all three.
- Dynamic or localized database attributes: use `getTranslatedField(translations, locale, field, fallback)` from `@/lib/utils`.

## Admin List Standards
- Prefer the standard `useAdminList` hook with `<DataTable>`, `<Pagination>`, `<SearchInput>`, and `<TableEmptyState>`.
- Hook owns debounce (350ms); pass `debounceMs={0}` to `<SearchInput>`.
- Always confirm destructive operations using `useConfirm()` and `<ConfirmDialog>`.

## Components & Styles
- Export components directly from their file — no barrel index exports (`export * from ...`).
- Use `cn(...)` from `@/lib/utils` for conditional class combinations.
- No heavy external third-party widget libraries without prior architectural note.
