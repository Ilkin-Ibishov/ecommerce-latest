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

## Modern Web Guidance (run before writing UI code)
- Before implementing or reworking any UI, CSS layout/animation, or client-side JS behaviour, run
  `npx -y modern-web-guidance@latest search "<2-5 word query>"`, then `retrieve "<id>"` for the
  matching guide(s). Query the user-visible capability, not the framework or our file names:
  `"light dismiss dialog"`, not `"close the admin ConfirmDialog in React"`. Split multi-feature
  tasks into separate searches.
- Prefer the platform feature the guide names over a hand-rolled pattern or a new dependency. This
  reinforces the existing rule against heavy third-party widget libraries.
- If `search` returns nothing relevant after one rephrase, proceed without it and say so.
- Does not apply to `artifacts/api-server/**`, `supabase/migrations/**`, SQL, CI or tooling.
- Known open finding (`legacy-scan`, 2026-11-13): four Enter-to-submit handlers lack an
  `event.isComposing` guard — `admin/ImageSearchTab.tsx:71`, `admin/PriceCell.tsx:37`,
  `admin/StockCell.tsx:78`, `storefront/profile/InlineEditor.tsx:54`. Low priority (breaks IME
  input in CJK languages only); fix when next touching those files, not as separate work.
