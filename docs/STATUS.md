# Project status — current state only

Last updated: 2026-11-18 (the 2026-11-17 session, which ran past midnight). The entry point for
a new session: what is true now,
what is open, and what waits on the owner. Superseded handoffs live in `docs/status/archive/`;
how work runs here lives in `docs/agent-workflow.md`. Everything referenced lives in this
repository; nothing important is only in a chat transcript.

## Start here — first thing to do in a new session (2026-11-18, the 2026-11-17 session past midnight)

**`main` is at `ee498c4` and green: CI runs 44174185233 (`Test`: 69 unit files, 54 component,
110 integration files, 42 E2E, no skips, no flaky) and 44174185297 (`Architectural invariants`:
21 checks, indexes current). It carries the whole agent-context-modularization change. Nothing is
in flight: no builder, no sub-agent, no other CI run.**

```bash
gh run list -b main -L 2 --json databaseId,name,conclusion   # expect success on both
git fetch -q origin && git log --oneline -3 origin/main
```

**This file is now current state only and stays near 10 KB. Read
`.claude/skills/session-start/SKILL.md` for your role** — it replaces pasting
`prompts/session-start-orchestrator.md`, and it names one spec instead of three.
`docs/agent-workflow.md` holds the process detail; read it when you need it, not up front.

### Merged to `main` this session

The approved design note `docs/design-notes/agent-context-modularization.md`, implemented in full,
items A-F in the order the note set:

| Item | What |
|---|---|
| **A** | `docs/STATUS.md` split: 81,724 bytes → 10 KB current state, `docs/agent-workflow.md` for durable process, six files under `docs/status/archive/`. Every non-blank line of the old file accounted for. `AGENTS.md` carries the pruning rule — the root cause was that nothing said to prune |
| **F** | `i18n-keys-exist-in-dictionaries` invariant (21 checks now), plus `en.ts`/`ru.ts` declared `const x: MessageSchema` so a key missing from one locale is a typecheck error. Proven against the defect it exists for; 5 fixture tests |
| **B** | `.agents/` → `.claude/`: four skills and two sub-agents now load in a Claude session, `migrations.md` became `supabase/AGENTS.md`, `frontend.md` and `express5-api.md` merged into their directories' `AGENTS.md`, `testing.md` and `inventory.md` became skills. `.gitignore` now denies `.claude/*` with narrow negations, so `.claude/worktrees` cannot be committed |
| **C** | Five new skills: `session-start`, `builder-round-accept`, `locale-key-add`, `e2e-diagnose`, `handoff-close` |
| **D** | Three read-only sub-agents: `ci-triage`, `doc-finder`, `schema-verifier` |
| **E** | `scripts/docs/build-index.mjs` writes an `INDEX.md` per doc directory (41 audits, 22 specs, 44 prompts, 8 design notes, 6 archives); `--check` runs in the invariants job and fails the build on a stale one |

Local tiers on the merged tree: typecheck clean, **759 unit tests in 70 files**, 21 invariants ok,
indexes current. One test was repointed, not weakened:
`m2c-reservations-bypass-and-fulfil.test.ts` reads the inventory rules text, which item B moved —
same three assertions, new path.

**Session start before this change read ~133 KB / ~37,000 tokens before the first line of work.
It now reads `AGENTS.md`, a 10 KB STATUS.md and the one spec the task needs.**

### What was deliberately not done

- **`.kiro/specs/` (~500 KB) is untouched and unindexed.** Nothing in `AGENTS.md` or the role skill
  references it, so it may be dead weight from an earlier tool. **One question for the owner**
  before anyone indexes it: is it live?
- **`TranslationKey = MessageKey | (string & {})`** in `messages/index.ts` still lets any string
  compile as a `t()` key. Tightening it would touch 1,463 call sites, some dynamic; the new
  invariant covers the literal ones instead. Recorded, not scheduled.
- Historical `prompts/*.md` and `docs/audits/*.md` keep their `.agents/` paths. They are the record
  of what a builder was given, not live configuration.

### Branches still open

| Branch | Tip | State |
|---|---|---|
| `fix/main-live-defects` | `2091e50` | **Fully superseded.** Its i18n lines and its design note are on `main`; its code commit is redundant and its red CI was the `POST /orders` 500 that `main` has fixed. Deletable |
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
7. **Is `.kiro/specs/` (~500 KB) live?** Nothing in `AGENTS.md` or the role skill references it.
   If it is dead weight from an earlier tool, say so and it goes; if it is live, it wants an index.

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
| `docs/status/archive/2026-11-17-evening.md` | 2026-11-17 evening — the orders subtotal_azn fix and the reservations locale key |
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
