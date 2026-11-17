# Project status — current state only

Last updated: 2026-11-17 (evening session). The entry point for a new session: what is true now,
what is open, and what waits on the owner. Superseded handoffs live in `docs/status/archive/`;
how work runs here lives in `docs/agent-workflow.md`. Everything referenced lives in this
repository; nothing important is only in a chat transcript.

## Start here — first thing to do in a new session (2026-11-17 evening)

**`main` is at `5d68825`. CI runs 44148760824 (`Test`) and 44148761095 (`Architectural invariants`)
were in progress when this was written — confirm them. Nothing else is in flight: no builder, no
sub-agent, no other CI run.**

**Do this first:** confirm those two runs, then ask the owner the questions below. There is no code
work queued — everything left is gated on an owner answer or a design-note review.

```bash
gh run list -b main -L 2 --json databaseId,name,conclusion   # expect success on both
git fetch -q origin && git log --oneline -4 origin/main
```

Then read `prompts/session-start-orchestrator.md` (your role).

### Merged to `main` this session

| Commit | What |
|---|---|
| `24022d0` | **`fix/orders-test-skip`**, `--no-ff`. The orders integration suite reported `5 tests \| 5 skipped` in every CI run because its setup threw a `ReferenceError` on an undeclared `verify` that the `catch` swallowed into `setupFailed`. Un-skipping it exposed the defect the previous handoff predicted: `orders.subtotal_azn` is `NOT NULL` with no default and `routes/orders.ts` never wrote it, so `POST /orders` returned 500. Both fixed; the setup now only skips on the documented "RPC not deployed" case and rethrows anything else. `database.types.ts` hand-patched for the column. Branch CI 44119041881 green |
| `5d68825` | **`Admin.Nav.reservations`** added to `az`, `en` and `ru`. The admin sidebar was rendering the raw key. Taken from `d242549` on `fix/main-live-defects` |

typecheck / `pnpm test:unit` (754 passed, 69 files) / `audit:invariants` (20 checks, all ok) were run
locally on the merged tree before the push. This worktree had no `node_modules`; `pnpm install
--frozen-lockfile` was needed first.

**Both defects that the previous handoff listed as "live on `main` right now" are now closed.**

### `fix/main-live-defects` — what is left on it

Its code commit `d242549` is superseded (the i18n lines were taken, the `verify` fix came in via
`fix/orders-test-skip`). What remains unmerged and **wants the owner's review** is its design note
`docs/design-notes/agent-context-modularization.md` (263 lines, `2091e50`): a measured audit finding
that `docs/STATUS.md` at 80 KB read in full at every session start is ~85% of the avoidable context
cost, and that `.agents/` is inert under Claude Code because this repository has no `.claude/`
directory. Research only, no implementation. The branch's own CI (44121162226) is red and can be
ignored — it failed for exactly the `POST /orders` 500 that `main` has now fixed.

### Branches still open

| Branch | Tip | State |
|---|---|---|
| `design/m4b-store-notifications` | `c29f55d` | Design note `docs/design-notes/m4b-store-notifications.md`. **Waiting for the owner's review. No implementation before approval** |
| `fix/otp-bypass-production` | `fef34e1` | Security fix (the `999999` bypass and rate-limit exemption are off where `NODE_ENV=production`). Pushed, **not merged**, now far behind `main`. Needs a rebase, a PR and the owner's merge |
| `design/delivery-fee`, `design/staff-provisioning` | unchanged | Still awaiting review |
| `feat/staff-provisioning` | — | Not mergeable; written without a spec, seven defects in the spec's §9 |

### Waiting on the owner — in this order

1. **Production database.** (a) Apply the nine M4 migrations — the agent may not touch production.
   (b) The `orders` / `product_specs` schema query from the morning section is **still unanswered**,
   and it still blocks the `database.types.ts` regeneration. On the test project
   `orders.subtotal_azn` is `NOT NULL` with no default and `routes/orders.ts` never writes it, so
   `POST /orders` cannot succeed there. **Fixed on `main` in `24022d0`** — the route now writes
   `subtotal_azn` and the orders integration suite proves it against the test project. The owner
   question that remains is whether **production** carries the same column, which still blocks the
   `database.types.ts` regeneration (it is hand-patched for this column today).
2. **Review `docs/design-notes/m4b-store-notifications.md`** (`design/m4b-store-notifications`).
3. **Review the two older design notes** (`design/delivery-fee`, `design/staff-provisioning`).
4. **Three M4 minors that need new migrations on the test project** (9: reservation guard for
   non-tracked variants in the database; 10: `FOR UPDATE` on the `track_stock` read in
   `trg_apply_stock_movement`; 13: `'in_progress'` is not a stocktake status). Applying them needs a yes.
5. **Two product decisions**: M4 minor 7 — a variant restocked yesterday after a long stock-out reads
   as "not selling" (which date is the floor?); the dashboard's old `stock < 10` banner — delete it or
   feed it from the low-stock signal.
6. **`fix/otp-bypass-production`**: rebase, PR, merge.

### Still open, ordered by what blocks what

1. The owner answers above. **Nothing goes to `main` without a yes.**
2. ~~Two defects live on `main`~~ — **both closed in `24022d0` and `5d68825`** (2026-11-17
   evening). The orders suite now runs for real and `POST /orders` writes `subtotal_azn`; the
   `Admin.Nav.reservations` key exists in all three dictionaries.
3. Minors recorded with `file:line`, not fixed:
   - Storefront round 2: a one-character query can show a stale suggestion dropdown
     (`HeaderSearchBar.tsx:27-31`, the `q.length < 2` return does not bump `requestRef`; Escape has the
     same gap); clicking away mid-request then refocusing shows stale suggestions; the order-success
     total is the client figure, not the server's.
   - Counter sale round 2: a late lookup result is dropped with no signal to the cashier
     (`CounterPage.tsx:160-163`); an invalid typed quantity reverts silently (`CartLines.tsx:23-33`);
     the scanner's `addItem` path has no 9999 cap. Also the pre-existing 4xx branch still surfaces the
     raw server `data.error` in the UI — worth deciding deliberately.
4. `artifacts/store/src/pages/admin/CounterPage.tsx` is **248 lines**. Not a rule violation (the
   200-line limit is for new files) but it is the obvious next extraction, as its own change.
5. After M4b approval: write the build prompt. The builder must confirm the §10 columns against the
   test project before writing a query.
6. Recorded, not scheduled: `database.types.ts` hand-patch vs regeneration (blocked on item 1b);
   print CSS of the in-page receipt (needs a browser); no automated test for the till's retry path or
   for the new discard-and-start-over path; mobile filter panel stays open after "apply".

## Open — business, blocking go-live, not engineering


**Business — blocking go-live, not engineering. Items 1 and 2 have not moved since 29 Oct —
that is now sixteen days across four sessions, while five engineering phases shipped.**

1. The 500 products' names, prices and photos. Nobody is assigned; the website cannot launch empty.
   Engineering completing M4 and M5 still leaves a finished, empty system.
2. Design-partner agreement and the monthly price. Still nothing signed and no price set. Each
   further phase raises the sunk cost without raising the chance of revenue, and negotiating a
   price from a finished product is harder than from an unfinished one, because the other side
   can see it was built anyway.
3. ~~The accountant's written answer on fiscal receipt requirements. Gates M3.~~ **Closed
   2026-11-13:** a plain non-fiscal receipt is enough, confirmed in writing. Outstanding only:
   whether the receipt must carry named fields (VÖEN, address) — one change to M3 spec §11,
   blocks nothing. File the written answer under `docs/knowledgebase/`.
13. **New (2026-11-13).** Two questions still with the customer, both from the M3 §16 rework in
    `docs/tasks/warehouse-m3-section-16-decisions.md`:
    - Do you charge for gift wrapping, a gift card/message, engraving or delivery?
    - **Do you sell gift certificates or store credit?** This is the one that matters and the
      original §16.11 wording hid it: a certificate is a liability until redeemed, not a
      product, and retrofitting it touches the ledger, the receipt and the day-end
      reconciliation at once. If yes, it is its own phase.
14. **New (2026-11-13).** The second shop (no barcode device) has not been asked about internet
    reliability. §16.5 was answered for one shop only, and M3b was dropped on that answer.

The numbered technical open items from earlier phases are in
`docs/status/archive/phase-state-m1-m4.md`.

## History

Superseded handoffs, archived verbatim. Nothing here is read at session start.

| File | Session |
|---|---|
| `docs/status/archive/2026-11-16-evening.md` | 2026-11-16 evening — three merges (storefront, counter sale, M4 follow-ups) |
| `docs/status/archive/2026-11-16-afternoon.md` | 2026-11-16 afternoon |
| `docs/status/archive/2026-11-16-morning.md` | 2026-11-16 morning |
| `docs/status/archive/2026-11-15.md` | 2026-11-15 — M4 |
| `docs/status/archive/2026-11-13.md` | 2026-11-13, and the 2026-11-10 first fully green CI |
| `docs/status/archive/phase-state-m1-m4.md` | M1-M4 phase state and the long numbered technical open list |

**How work runs here — the phase pipeline, the builder, the model quota, the failure modes this
project has produced, and the lessons worth keeping — moved to `docs/agent-workflow.md`.**

## The rule that keeps this file small

A new handoff **replaces** the "Start here" block; the one it replaces moves to
`docs/status/archive/<date>-<slot>.md` in the same commit, with a row added to the History table
above. Nothing superseded stays in this file. Without this rule the file grows back: it reached
80 KB, 45% of it under headings that told the reader to skip them, which is about 19,000 tokens
read and discarded at every session start.
