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
