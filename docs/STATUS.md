# Project status — current state only

Last updated: 2026-11-18 evening. The entry point for
a new session: what is true now,
what is open, and what waits on the owner. Superseded handoffs live in `docs/archive/status/`;
how work runs here lives in `docs/agent-workflow.md`. Everything referenced lives in this
repository; nothing important is only in a chat transcript.

## Start here — first thing to do in a new session (2026-11-18, evening)

**`main` is green at `ab4afaa`** (runs 44315381897 `Architectural invariants`, 44315381868 `Test`).
Open PRs from this session: **#21** `fix/sign-in-keeps-role` and the docs PR carrying this file.
Merge each when its CI is green, then check `main`'s own run.

```bash
gh run list -b main -L 2 --json databaseId,name,conclusion   # expect success on both
gh pr list --json number,title,headRefName                   # #21 and the review PR, or none
```

The one skip is permanent and declared: `tests/e2e/super-admin-platform.spec.ts:4` skips itself
unless `SUPER_ADMIN_E2E` is set, so a green E2E run is **43 tests, 42 passed, 1 skipped**.

**Read `.claude/skills/session-start/SKILL.md` for your role.** There is **no production project**
(`docs/knowledgebase/supabase-projects.md`). Git mechanics are the agent's; product decisions stay
the owner's. On 2026-11-18 the owner **delegated design-note review to the architect**
("review/audit yourself and proceed").

### Do this first, in this order

1. **Implement staff provisioning** (`docs/tasks/staff-provisioning.md`). Its note is approved with
   amendments **A1** (open the admin shell to staff, role-filtered sidebar) and **A2** (tracked
   `audit_log` DDL) — `docs/design-notes/staff-provisioning.md` §12. Fresh phase branch from
   `main`; builder via the `agy-builder-run` skill; adversarial audit before merge.
2. **Then M4b** (`docs/design-notes/m4b-store-notifications.md`, approved as written, §12).
3. **Write the design note for `docs/tasks/delivery-cost-at-confirmation.md`.** It absorbs what
   is still current of `docs/design-notes/delivery-fee.md` — the table in that note's §12 says
   which parts. No production means §9.3's `NOT VALID` question is moot for now; say so.

### What this session did

- **Reviewed the three design notes** (verdicts in each note's §12; spec `Status:` lines updated).
- **#21 — sign-in no longer demotes a legacy-format staff/admin to `customer`** (live defect on
  `main`, found by the staff-provisioning note §5).
- **OTP bypass: kept in the test environment on purpose** (owner, 2026-11-18). The production
  launch gate — merge `fix/otp-bypass-production` (`fef34e1`) and run with `NODE_ENV=production`
  — is recorded in `docs/knowledgebase/supabase-projects.md`. Do not merge it before then.
- **Closed PR #12** (the 2026-11-11 handoff, superseded).

### Branches

The repository holds ~50 remote and ~90 local branches and 29 worktrees; only a handful carry
live work. The analysis and the cleanup plan are in `docs/agent-workflow.md` "Branches".
**Cleanup waits on the owner's yes** (deleting remote branches is outward-facing).

| Branch | State |
|---|---|
| `fix/otp-bypass-production` | **Keep.** The production launch gate above |
| `feat/staff-provisioning` | Evidence for the phase (note §8 says which files are kept); delete after the phase merges |
| `design/staff-provisioning`, `design/m4b-store-notifications`, `design/delivery-fee`, `draft/delivery-fee-subagent` | Notes now on `main` via the review PR; deletable after it merges |

### Waiting on the owner

1. **Branch cleanup** — yes/no on the plan in `docs/agent-workflow.md` "Branches".
2. **`AnnouncementBar`** content once its 100 AZN message goes. Recommendation on record: text
   from the existing unread setting (`20260606110418_create_store_settings.sql:18-20`), empty
   means not rendered, dismissal kept in `localStorage`. Its own small change.
3. **Three M4 minors that need migrations on the test project** (9: reservation guard for
   non-tracked variants; 10: `FOR UPDATE` on the `track_stock` read in `trg_apply_stock_movement`;
   13: `'in_progress'` is not a stocktake status). Applying them needs a yes.
4. **Two product decisions**: M4 minor 7 (which date floors "not selling" after a long stock-out);
   the dashboard's `stock < 10` banner — delete, or feed it from the low-stock signal.
5. **A city/region field on orders** before any delivery-zone work (`schema.sql:741` is free text).

### Still open, ordered by what blocks what

1. **The test project nears PostgREST's 1000-row cap**: `GET /admin/inventory/signals/reorder` had
   694 rows on 2026-11-18, ~90 CI runs from the cap; any test that searches a whole list for its
   own row has the flaw (#16 fixed the RPC-level ones). Seed `test-product-2/3` have no variants.
2. **`product_variants.track_stock` is read by nothing** in the ledger or the counter path; a
   non-tracked variant still moves stock. Needs an invariant (no such variant in `stock_movements`).
3. **Four defects on `main` from the M4b note §9** — `GET /platform/notifications` is
   `requireUser` (any shopper's token passes) first; the order page's WhatsApp log reads a missing
   `notification_queue`; `OrderDetailPage.tsx:39` maps an unknown `low_stock` type;
   `m4-stock-signals.unit.test.ts:67-92,219-256` tests a function defined in the test.
4. Minors with `file:line` are listed verbatim in `docs/archive/status/2026-11-18-evening.md`
   (storefront round 2, counter sale round 2, `CounterPage.tsx` at 248 lines, unscheduled items).


## Open — business, blocking go-live, not engineering

**Items 1 and 2 have not moved since 29 Oct — twenty days across six sessions, while five
engineering phases shipped and a sixth was specced.**

1. The 500 products' names, prices and photos. Nobody is assigned; the website cannot launch empty.
   Engineering completing M4 and M5 still leaves a finished, empty system.
2. Design-partner agreement and the monthly price. Still nothing signed and no price set. Each
   further phase raises the sunk cost without raising the chance of revenue, and negotiating a
   price from a finished product is harder than from an unfinished one, because the other side
   can see it was built anyway.
3. **Do you charge for gift wrapping, a gift card/message or engraving?** From the M3 §16 rework
   (`docs/archive/tasks/warehouse-m3-section-16-decisions.md` §16.11). Delivery is covered by its own
   spec now. A yes means a `track_stock = false` variant — sells, prints on the receipt, earns
   revenue, writes no stock movement. Cheap either way, and the `track_stock` defect behind it
   (item 3 of the list above) needs fixing whatever the answer is.
   ~~Do you sell gift certificates or store credit?~~ **Answered 2026-11-18: no.** The deferred
   row in `docs/tasks/warehouse-roadmap.md` stands; re-open only as its own phase.
4. **The second shop has not been asked about internet reliability.** §16.5 was answered for one
   shop only, and M3b (the offline queue) was dropped on that answer.
5. Minor, blocks nothing: whether the receipt must carry named fields (VÖEN, address) — one change
   to the M3 spec §11. The accountant's "a plain non-fiscal receipt is enough" is confirmed in
   writing (2026-11-13) and should be filed under `docs/knowledgebase/`.

The numbered technical open items from earlier phases are in
`docs/archive/status/phase-state-m1-m4.md`.

## History

Superseded handoffs, archived verbatim. Nothing here is read at session start.

| File | Session |
|---|---|
| `docs/archive/status/2026-11-18-evening.md` | 2026-11-18 afternoon block — superseded by the evening review session (three notes reviewed, #21) |
| `docs/archive/status/2026-11-18-afternoon.md` | 2026-11-18 afternoon — docs archived and deduplicated, CI fixed and sped up (#15-#19) |
| `docs/archive/status/2026-11-18-morning.md` | 2026-11-18 morning — agent-context modularization items A-F, `.kiro/` and `ltm/` removed |
| `docs/archive/status/2026-11-17-evening.md` | 2026-11-17 evening — the orders subtotal_azn fix and the reservations locale key |
| `docs/archive/status/2026-11-16-evening.md` | 2026-11-16 evening — three merges (storefront, counter sale, M4 follow-ups) |
| `docs/archive/status/2026-11-16-afternoon.md` | 2026-11-16 afternoon |
| `docs/archive/status/2026-11-16-morning.md` | 2026-11-16 morning |
| `docs/archive/status/2026-11-15.md` | 2026-11-15 — M4 |
| `docs/archive/status/2026-11-13.md` | 2026-11-13, and the 2026-11-10 first fully green CI |
| `docs/archive/status/phase-state-m1-m4.md` | M1-M4 phase state and the long numbered technical open list |
