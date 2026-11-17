# Archived from docs/STATUS.md — 2026-11-16 afternoon

Verbatim. That session's full handoff. **Superseded**: read `docs/STATUS.md` for current state and
`docs/agent-workflow.md` for how work runs here. Kept so nothing is lost, not to be read at
session start.

## Previously — the 2026-11-16 afternoon session (superseded where the section above disagrees)

**M4 is merged to `main` (`711781c`, CI green). Three branches are in fix rounds; one builder run and
one CI run were still going when this was written.** Nothing else has been merged to `main`.

**Do this first** — find out how the two in-flight things ended:

```bash
gh run view 43846603768 --json conclusion,jobs --jq '.conclusion, (.jobs[]|.name+": "+.conclusion)'
cat .claude/worktrees/fix-counter-sale/.agent-runs/LAST-RUN.done
git -C .claude/worktrees/fix-counter-sale log --oneline origin/fix/counter-sale-confirmation..HEAD
```

- Run **43846603768** is `Test` on `fix/m4-follow-ups` (`1a228c5`), dispatched by hand
  (`gh workflow run test.yml --ref <branch>`; CI only triggers itself on `main` and on PRs). `unit` had
  passed; `integration-e2e` was in progress. It is the first real run of the strengthened test in
  `m4-stock-signals.integration.test.ts` (case 1): if that fails, the fixture is not returned at
  `days=90` and that is a real finding, not a reason to weaken the test.
- The **AGY builder** was on `prompts/fix-counter-sale-confirmation-round-2.md` in the worktree
  `.claude/worktrees/fix-counter-sale` (run started 13:54). `LAST-RUN.done` names the round-2 prompt
  when it has finished; while it still names round 1, the run is going or died. At hand-off it had
  made 7 of 8 fix commits **locally, not pushed** (`baa8e6c` … `fb2565f`); item 8 (translations and the
  E2E spec) and the notes were still to come. **Its diff has not been audited.** Audit it against the
  prompt, run the three local commands, then `git push origin HEAD:fix/counter-sale-confirmation`.

Then read `prompts/session-start-orchestrator.md` (your role).

### Branches, exactly (all based on `main` at `711781c`, none behind it)

| Branch | Tip | State |
|---|---|---|
| `fix/storefront-mobile-spa` | `14ad31e` | Rebased on M4. Fix rounds 1 and 2 built, audited against their prompts and pushed. Local tiers pass (741 unit tests). **CI not run. Round 2 not re-audited.** Local branch name in its worktree is `round/storefront-fix` |
| `fix/counter-sale-confirmation` | `1ec132d` pushed | Rebased on M4. Round 1 built, audited, pushed (`8b0fdea`; 749 unit tests). Round 2 prompt pushed (`1ec132d`); **round 2 build in flight, see above** |
| `fix/m4-follow-ups` | `1a228c5` | New. Three M4 minors fixed (settings read, inventory page error state, vacuous test). Audited against the prompt, pushed, local tiers pass (746). CI run 43846603768 in flight |
| `design/m4b-store-notifications` | `c29f55d` | Design note `docs/design-notes/m4b-store-notifications.md`. **Waiting for the owner's review. No implementation before approval** |
| `audit/storefront-mobile-spa-round-1` | `3db8be1` | Re-audit report, verdict FIX (its majors are what round 2 fixed) |
| `audit/counter-sale-confirmation-round-1` | `bb9ea4d` | Re-audit report, verdict FIX (its majors are what round 2 fixes) |
| `fix/otp-bypass-production`, `design/delivery-fee`, `design/staff-provisioning` | unchanged | 55 commits behind `main` now; see the morning section |

Prompts live on their own branch: `prompts/fix-<branch>-round-N.md`, `prompts/fix-m4-follow-ups.md`.
Builder notes: `docs/audits/fix-storefront-mobile-spa-round-1-notes.md` (both rounds),
`docs/audits/fix-counter-sale-confirmation-round-1-notes.md`, `docs/audits/fix-m4-follow-ups-notes.md`.

### What changed this session

- **M4 merged** to `main` with the owner's yes: `711781c`, `--no-ff`, CI green (`unit`,
  `integration-e2e`, invariants). **Its nine migrations are applied to the test project only.** Whether
  production deploys from `main` automatically was not checked; if it does, the code now calls RPCs
  and views production does not have.
- **Both fix branches rebased** on `main` (no conflicts) and force-pushed with a lease. Old tips, in
  case they are wanted: `fix/counter-sale-confirmation` `19a6dd8`, `fix/storefront-mobile-spa` `f57142c`.
- **Storefront**: round 1 removed the client-only 5 AZN delivery fee, the invented size-guide table and
  the `/size-guide` page, the `"dsdvsdv"` slug filter; `overflow-x: hidden` → `clip`; request-order
  guard in `ProductsPage.tsx`. Round 2 fixed what the re-audit found: cart drawer closing itself on
  checkout, suggestion dropdown reopening over results, scroll lock leaking (`clip` on `body` only),
  and a defect that is **also on `main`**: the order-success message says "0.00 AZN" because the total
  is read after `clearCart()`.
- **Counter sale**: round 1 fixed the nine first-audit findings (frozen cart and stable `sold_at` on
  retry, change from the server total in whole qəpik, whole-number quantity, `Admin.Counter`
  translations in az/ru/en). The re-audit found three new majors — the E2E spec
  `artifacts/store/tests/e2e/counter-sale.spec.ts` no longer matches the UI, the lookup box steals
  focus from the quantity and tender inputs, a 5xx after commit still ends in a 409 loop — plus
  minors, including M4 audit minor 5 (false stock warning on non-tracked lines). Round 2 covers them.
- **M4b design note** written by the architect. It drops two spec items (failed customer messages;
  goods receipt reversed), moves the bell to the sidebar, keeps the platform count out of the badge,
  and limits staff to two items — each with its reason, §2 of the note.
- **Defects found on `main`, not fixed** (all in the M4b note §9 or the re-audits):
  - `GET /admin/orders/:id/notifications` reads `notification_queue`, a table that does not exist; the
    order page's WhatsApp log is always empty.
  - The platform-announcement chain is broken in four places and `GET /platform/notifications` is
    `requireUser` — any signed-in shopper's token passes.
  - Staff cannot enter the admin UI at all: `AdminLayout.tsx:105-107` admits `role === "admin"` only.
  - Checkout never recomputes the coupon discount when the cart changes; the shown total can differ
    from what the server stores.

### Waiting on the owner — in this order

1. **Production database.** (a) Apply the nine M4 migrations — the agent may not touch production.
   (b) The schema query from the morning section (`orders`, `product_specs`) is still unanswered.
2. **Review `docs/design-notes/m4b-store-notifications.md`** (`design/m4b-store-notifications`).
3. **Review the two older design notes** (`design/delivery-fee`, `design/staff-provisioning`).
4. **Three M4 minors that need new migrations on the test project** (9: reservation guard for
   non-tracked variants in the database; 10: `FOR UPDATE` on the `track_stock` read in
   `trg_apply_stock_movement`; 13: `'in_progress'` is not a stocktake status). Not started: applying
   them needs the owner's yes.
5. **Two product decisions**: M4 minor 7 — a variant restocked yesterday after a long stock-out is
   listed as "not selling" (which date is the floor?); the dashboard's old `stock < 10` banner —
   delete it or feed it from the low-stock signal.
6. Merges of the three fix branches, when each is green. **Nothing goes to `main` without a yes.**

### Still open, ordered by what blocks what

1. Finish the two in-flight items ("Do this first").
2. Run CI on `fix/storefront-mobile-spa`, then on `fix/counter-sale-confirmation` — **one at a time**:
   the runs share one test database. Counter sale's E2E spec was rewritten by a builder that could not
   run it; expect to fix selectors from the first run's log.
3. Re-audit round 2 of each fix branch (read-only sub-agent, clean context) before asking for a merge.
4. After M4b approval: write the build prompt. The builder must confirm on the test project the
   columns the note lists in §10 before writing a query.
5. Recorded, not scheduled: `database.types.ts` hand-patch vs regeneration (M4 minor 12, still
   blocked on the production schema answer); print CSS of the in-page receipt (needs a browser); no
   automated test for the till's retry path; mobile filter panel stays open after "apply".

### Operational notes from this session

- **Resetting another worktree is refused by the permission classifier** (`git -C <other> reset --hard`).
  Make a fresh worktree instead: `git worktree add ../<name> <branch>`, or
  `git worktree add -b <local> ../<name> origin/<branch>` when the branch is checked out elsewhere
  (that is why the storefront worktree's branch is `round/storefront-fix`). Push with
  `git push origin <local>:<branch>`.
- **A new worktree has no `node_modules`.** Run `pnpm install --frozen-lockfile --prefer-offline`
  (about 40 s) before launching the builder, or its typecheck fails.
- **Builders run in parallel fine, one per worktree** — three at once this session. Launch from the
  PowerShell tool, in the background; `.agent-runs/` appears within seconds; a run takes 10–25 minutes.
- **Prompt delivery that works**: in the orchestrator's worktree `git checkout -b tmp/x origin/<branch>`,
  write the prompt, commit, `git push origin tmp/x:<branch>`, then `git -C <builder-worktree> pull --ff-only`
  (or `merge --ff-only origin/<branch>`), then go back to the session branch.
- **Sub-agents with `isolation: "worktree"`** left their reports on local branches in
  `.claude/worktrees/agent-ac9232491ef44edcd` and `agent-a7b50a6ce62a33c4b`; both are pushed, both
  worktrees are removable. Read-only scoping agents (no isolation) returned exact `file:line` reports
  that held up on every spot check; the full text of the two scoping reports is only in the session
  transcript — what matters from them is in the M4b note and `prompts/fix-m4-follow-ups.md`.
- **Radix dialogs hide the rest of the page from the accessibility tree.** An E2E assertion on
  something outside an open dialog (`getByRole("status")`) fails; assert inside the dialog first.
- Removable local leftovers: branch `m4/types`; worktrees `fix-storefront`, `fix-m4-follow-ups`,
  `fix-counter-sale` once their branches merge; the stale `agent-a1464322567031a5c` (old storefront tip).
