# CI / testing operational lessons (2026-11-05 through 2026-11-10)

Cross-cutting lessons from the session that got `integration-e2e` fully green for the first time
ever (`docs/STATUS.md` has the full round-by-round history; this file is the "don't rediscover
these the hard way" summary).

## The recurring root cause: unchecked Supabase client errors

The single most common bug pattern this session, found independently in at least three unrelated
places:

```ts
const { data } = await supabase.from(...).select(...);
// data is null/undefined on error — the error itself is never inspected
```

When the query fails (missing column, invalid filter value, RLS denial), `data` comes back `null`
and the code silently falls through to an "empty"/"not found" branch instead of surfacing the
actual failure. This is why the entire storefront product listing rendered as empty for an
unknown amount of time (traced to a 400 from a missing `original_price` column — see
`docs/STATUS.md` round 13) with no visible error anywhere. When a page or test behaves as if there
is "no data" and you can't immediately see why, suspect this pattern first: check what the
underlying query would actually return (`curl` the REST endpoint directly, or re-run the query
with `error` destructured) before assuming the data genuinely doesn't exist.

## Playwright + this codebase's SPA (wouter) routing

`page.waitForLoadState("networkidle")` **does nothing useful after a client-side route change**.
Wouter (and any client-side router) swaps route components via `history.pushState`, not a real
browser navigation — Playwright's navigation-lifecycle tracking never resets for that, so
`waitForLoadState` resolves near-instantly regardless of whether the new route's own async data
fetch has finished. `admin-panel.spec.ts` already had a comment warning off `networkidle` for a
different reason (persistent open connections never going idle); this session found a second,
independent reason the same advice applies. The reliable fix: wait for a specific element that
only renders once the new route's real data has loaded (e.g. an add-to-cart button gated on
`productId && !outOfStock`) before reading any content from the page.

## This test suite's recurring locator-ambiguity pattern

Once a page actually renders real content (rather than an empty/loading state), broad locators
written and only ever run against empty pages routinely turn out to match multiple elements:
`getByText("Revenue")` also matching a caption containing the word; `button[type="submit"]`
matching both a header search button and the real form's submit button; `[class*="fixed"]`
matching the mobile bottom nav, a notifications region, and the actual target. **Any E2E test file
that has never had content to actually assert against is a liability, not a safety net** — treat a
sudden wave of strict-mode violations after a real data/schema fix as *progress*, not a new
problem: it means the page is finally rendering, and the fix is almost always adding `.first()` or
a `.filter({ hasText: ... })`, not rethinking the test.

## This repo's AGY builder facts worth knowing (unchanged from before, re-confirmed)

- Launch via PowerShell directly (`& "scripts\agent\run-agent.cmd" "prompts\<name>.md"`), not
  `cmd.exe /c` through Bash — the latter silently no-ops (prints the banner, exits 0, never starts
  `agy.exe`, never creates `.agent-runs/`).
- Confirm a launch actually started by checking `.agent-runs/` for a new log file within ~10
  seconds, and that `.agent-runs/LAST-RUN.done` still shows the *previous* run's marker (not yet
  updated) — don't just trust the launch command's own exit code.
