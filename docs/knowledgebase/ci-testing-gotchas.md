# CI / testing gotchas

Patterns that each cost a session to find. Diagnosing a failed run: skill `e2e-diagnose`. Locale
assertions: skill `locale-key-add`.

## How `integration-e2e` is set up (2026-11-18, #17 and #19)

- Runs in the `mcr.microsoft.com/playwright:v1.60.0-noble` container. The tag must match
  `@playwright/test` in `pnpm-lock.yaml`; bump both together.
- The API and store dev servers start with `nohup … > /tmp/*.log &`; a bare `&` died in the
  container. The logs print in "Server logs on failure".
- E2E admin specs reuse one session: `tests/e2e/auth.setup.ts` signs in once and saves
  `tests/e2e/.auth/admin.json` (git-ignored, live tokens); specs use
  `test.use({ storageState: ADMIN_STATE })` from `tests/helpers/admin-auth.ts`. A new admin spec
  should do the same rather than sign in per test. CI runs 3 Playwright workers.
- Runs queue on one concurrency group because every run shares the one test project.

## Unchecked Supabase client errors

The most common bug pattern in this codebase, found in at least three unrelated places:

```ts
const { data } = await supabase.from(...).select(...);
// data is null on error — the error itself is never inspected
```

A failing query (missing column, bad filter, RLS denial) returns `data: null` and the code falls
through to an "empty" or "not found" branch. The whole storefront listing once rendered empty this
way, from a 400 on a missing `original_price` column, with no visible error. When a page or test
behaves as if there is no data, check what the query actually returns (`curl` the REST endpoint, or
destructure `error`) before believing the data is absent.

## Playwright and wouter (SPA) routing

`page.waitForLoadState("networkidle")` does nothing useful after a client-side route change: wouter
swaps routes with `history.pushState`, so Playwright's navigation tracking never resets and the wait
resolves at once. (It also never settles on pages with persistent connections.) Wait for an element
that only renders once the new route's data has loaded.

## Locators

- **A wait that something else can satisfy is not a wait.** The admin Inventory block in
  `admin-panel.spec.ts` was green for months by accident: its `beforeEach` waited for
  `getByText("Out of Stock")`, which a filter chip renders during loading as well as the summary
  card after it. A slow runner exposed it (fixed in `bf9e7bc` with a `data-testid` on the loaded
  grid). Prefer a testid on the loaded container to a word that appears in it.
- **Suspect a test that only ever passed quickly.** Timing did not break that test; it revealed it.
- **Chips, badges, filters and headings reuse dictionary strings by design**, and `getByText`
  matches substrings, so page-wide text locators get less reliable as the dictionary grows.
- A file that has only ever run against empty pages is a liability. When real data finally
  renders, a wave of strict-mode violations is progress: scope the locator (a container, a
  `.filter({ hasText })`) rather than rethinking the test.

## Test data on the test project

`goods-receipts-post-route.integration.test.ts` leaves a permanent product/variant on every run
that posts a receipt: `stock_movements` is append-only, so nothing can delete a variant a movement
points to. The test gives the product a translation so the orphans do not break storefront pages.
Do not "fix" this by weakening the ledger's append-only invariant.
