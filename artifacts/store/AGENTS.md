# Frontend Store & Admin Agent Guidelines

This directory (`artifacts/store`) contains the user-facing storefront and admin web application.

## Key Stack & Libraries
- React 18+ with TypeScript and Vite
- Routing: Wouter (Storefront: `/${locale}/*`, Admin: `/admin/*`)
- UI Components: shadcn/ui primitives (Radix base + Tailwind CSS)
- Server State: TanStack React Query

## Core Rules for This Directory
1. **i18n Requirement**: No plain text strings in UI. Every label, button, placeholder, and heading must use `t("key")`. New keys must be added across `az.ts`, `ru.ts`, and `en.ts` in `lib/i18n/messages/`.
2. **Admin Pages**: Standard admin tables must use `useAdminList` + `DataTable` + `Pagination` + `SearchInput` rather than custom table code.
3. **API Integration**: Prefer generated client hooks from `@workspace/api-client-react` or `apiUrl()` helper from `lib/api.ts`.
4. **No Barrel Exports**: Export components directly from their file (avoid `index.ts` re-export spam).
5. **Validation**: Run `pnpm run typecheck` and `pnpm run test:unit` to verify UI logic before committing.

---

The detail, merged here from `.agents/rules/frontend.md` on 2026-11-17 so that it loads
by scope instead of relying on a frontmatter trigger Claude Code does not read.

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
