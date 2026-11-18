# Project status — current state only

Last updated: 2026-11-18 afternoon. The entry point for
a new session: what is true now,
what is open, and what waits on the owner. Superseded handoffs live in `docs/archive/status/`;
how work runs here lives in `docs/agent-workflow.md`. Everything referenced lives in this
repository; nothing important is only in a chat transcript.

## Start here — first thing to do in a new session (2026-11-18, afternoon)

**`main` is green at `2424bc1`: CI runs 44312152346 (`Architectural invariants`) and 44312152183
(`Test`: `unit` 57 s and `integration-e2e` 284 s, both success).** Nothing is in flight: no
builder, no sub-agent, no CI run, no open PR from this session.

```bash
gh run list -b main -L 2 --json databaseId,name,conclusion   # expect success on both
git fetch -q origin && git log --oneline -3 origin/main
```

The one skip is permanent and declared: `tests/e2e/super-admin-platform.spec.ts:4` skips itself
unless `SUPER_ADMIN_E2E` is set, so a green E2E run is **43 tests, 42 passed, 1 skipped**.

**Read `.claude/skills/session-start/SKILL.md` for your role.** `docs/agent-workflow.md` holds the
process detail; read it when you need it, not up front.

**There is no production project** (owner, 2026-11-18: not created yet; the `vercel.json` hosts
are gone — `docs/knowledgebase/supabase-projects.md`). `ecommerce-warehouse` is the only database.
Older notes and specs that ask about "production" describe a database that does not exist yet.

**Git mechanics are the agent's** (owner, 2026-11-18): commits, branches, PRs, and merging a PR
whose CI is green. Product decisions — specs, design-note approvals, the database — stay the
owner's. Never commit to `main` directly (AGENTS.md).

### Do this first, in this order

1. **`fix/otp-bypass-production` (`fef34e1`) — security; must merge before anything is hosted.**
   `artifacts/api-server/src/lib/otp.ts:13-18` hardcodes three phones and the code `999999`, and
   its own comment says they "accept TEST_CODE in any environment". In `verifyOTP` the bypass is
   checked at `:120`, **before** the `IS_DEV` branch, so it would be live on any deployment;
   `checkRateLimit` (`:71`) also exempts those phones everywhere. On the test project **two of
   those three hold `admin` and `staff`** (`docs/design-notes/staff-provisioning.md` §1). Not
   exposed today, because nothing is hosted. Rebase the branch onto `main` (far behind), open a
   PR, merge when green. It turns the bypass and the rate-limit exemption off where
   `NODE_ENV=production`. Check that the E2E admin sign-in (`artifacts/store/tests/helpers/admin-auth.ts`,
   `+994550000001` / `999999`) still works under CI's `NODE_ENV`.
2. **Ask the owner to review `docs/design-notes/staff-provisioning.md`** (`design/staff-provisioning`,
   `d471185`). It blocks M4b: `AdminLayout.tsx:105-107` admits `role === "admin"` only, so staff
   cannot enter the admin UI and M4b's staff filter would be unreachable. It also found a live
   defect on `main` — `routes/auth.ts:98-102` upserts `role: "customer"` when the lookup by
   canonical phone misses, which **demotes a legacy-format staff or admin row on sign-in**.
3. **Write the design note for `docs/tasks/delivery-cost-at-confirmation.md`.** The spec is
   complete; the note is the next artifact. Its §9.3 (`NOT VALID` constraint for existing
   production rows) and §9's backfill question assume a production database — with none, the note
   should say so and propose the constraint for the test project and a fresh production. New
   work, so it waits behind 1-2.

### What this session put on `main`

- **#15 — docs reorganised.** Merged phases' specs, design notes, audits and prompts, the old
  handoffs and the May–June plans moved to `docs/archive/` (hidden from search by `.ignore`; search
  by path). Live markdown 1.77 MB → ~175 KB. Every `docs/tasks` spec has a `Status:` line that
  `docs:index` enforces. `docs/tasks/backlog.md` re-verified against the code. Layout:
  `docs/agent-workflow.md` "Where things are".
- **#16 — M4 signal tests filter server-side.** The test project returns more than PostgREST's
  1000-row cap; tests searching the whole result missed their own row or passed vacuously.
- **#17 — `integration-e2e` queues** on one concurrency group, so runs no longer share the test
  database at the same time.
- **#18 — `orders.test` names `test-product-1`**, the only seeded product with a variant.
- **#19 — CI ~12.5 → ~4.8 min.** Playwright container (no browser install), admin session saved
  once by a setup project and reused (21 OTP sign-ins → 1), 3 E2E workers, `integration-e2e` no
  longer waits for `unit`. A 6-worker vitest trial gained nothing and was reverted.

### Branches still open

| Branch | Tip | State |
|---|---|---|
| `fix/otp-bypass-production` | `fef34e1` | **The security fix. Start here (item 1); merge before anything is hosted.** Turns the `999999` bypass and the rate-limit exemption off where `NODE_ENV=production`. Pushed, **not merged**, far behind `main`: needs a rebase, a PR, and a merge once green |
| `design/staff-provisioning` | `d471185` | Design note. **Waiting for the owner's review.** Blocks M4b; also carries the `routes/auth.ts` sign-in demotion defect |
| `design/m4b-store-notifications` | `c29f55d` | Design note. **Waiting for the owner's review. No implementation before approval** |
| `design/delivery-fee` | `bc754b6` | Design note. Partly superseded by `docs/tasks/delivery-cost-at-confirmation.md`, which names the sections it replaces. Review what is left of it, or review the new spec's note when it exists |
| `fix/main-live-defects` | `2091e50` | **Fully superseded** — its i18n lines and design note are on `main`, its code commit is redundant, its red CI was the `POST /orders` 500 `main` has fixed. Deletable |
| `feat/staff-provisioning` | — | Not mergeable; written without a spec, seven defects against the spec's §9 |
| `docs/handoff-2026-11-11` (PR #12) | — | Old handoff PR, still open, superseded by every later handoff. Close it |

### Waiting on the owner — in this order

1. **Review `docs/design-notes/staff-provisioning.md`.** First of the three, because it blocks
   M4b and carries a live defect.
2. **Review `docs/design-notes/m4b-store-notifications.md`.**
3. **Review what remains of `docs/design-notes/delivery-fee.md`.** Two of its three questions are
   answered (2026-11-18): the `PoliciesPage` flat-rate sentence is **deleted**, not reworded, in
   all three languages, and the 100 AZN threshold must not survive as a literal anywhere. Its
   checkout-time flat-fee model is superseded where the regional amount is unknown — see the new
   spec, which also fixes the az/ru/en strings and both WhatsApp texts in its §13.
   **Still open: what the `AnnouncementBar` says** once its only message, which hard-codes
   100 AZN, is gone. Owner-editable text for it already exists as settings nobody reads
   (`20260606110418_create_store_settings.sql:18-20`) while the bar renders the i18n string. The
   recommendation on record: text from the setting, empty means the bar is not rendered, dismissal
   remembered in `localStorage` (today `useState`, so it returns on every reload), and no claim
   in it that the system cannot verify. Its own small change, not part of a delivery phase.
4. **Three M4 minors that need new migrations on the test project** (9: reservation guard for
   non-tracked variants in the database; 10: `FOR UPDATE` on the `track_stock` read in
   `trg_apply_stock_movement`; 13: `'in_progress'` is not a stocktake status). Applying them needs
   a yes.
5. **Two product decisions**: M4 minor 7 — a variant restocked yesterday after a long stock-out
   reads as "not selling" (which date is the floor?); the dashboard's old `stock < 10` banner —
   delete it or feed it from the low-stock signal.
6. **A city or region field on orders.** `orders.delivery_address` is one free-text column
   (`schema.sql:741`). Any future delivery-zone model has nothing to key on and old orders cannot
   be classified after the fact. Small, independent, and worth doing before zone work rather than
   after. Named in the new spec's §8 as deliberately out of its scope.

### Still open, ordered by what blocks what

1. The owner answers above.
2. **The test project outgrows PostgREST's 1000-row cap.** Every CI run adds variants the
   append-only ledger keeps. `m4-stock-signals` test 2 reads `GET /admin/inventory/signals/reorder`,
   which has no variant filter: 694 rows on 2026-11-18, roughly 90 runs from the cap. Any test
   that searches a whole list for its own row has the same flaw (#16 fixed the RPC-level ones).
   Also unexplained: seed products `test-product-2/3` have no variants, and the seed creates none.
3. **`product_variants.track_stock` is declared and read by nothing.** The ledger
   (`20261102100000_m1_variants_ledger.sql`) and the counter path
   (`20261111120400_m3_post_counter_sale.sql`) never check it, so a `track_stock = false` variant
   set from the admin UI today still goes through the ledger and still has its on-hand
   decremented, silently. `docs/archive/tasks/warehouse-m3-section-16-decisions.md` §16.11 records it;
   M4 minor 9 is the closest scheduled item. It needs an invariant asserting no such variant
   appears in `stock_movements`. Independent of whether the shop ever sells services.
4. **Four defects `docs/design-notes/m4b-store-notifications.md` §9 found on `main`**, none fixed:
   `GET /admin/orders/:id/notifications` reads a `notification_queue` table that does not exist,
   so the order page's WhatsApp log is always empty; the platform-announcement chain is broken in
   four places and `GET /platform/notifications` is `requireUser`, so any signed-in shopper's
   token passes; `OrderDetailPage.tsx:39` maps a `low_stock` type `NotifType` does not have; and
   `m4-stock-signals.unit.test.ts:67-92,219-256` tests a function defined inside the test file
   with no production counterpart.
5. Minors recorded with `file:line`, not fixed:
   - Storefront round 2: a one-character query can show a stale suggestion dropdown
     (`HeaderSearchBar.tsx:27-31`, the `q.length < 2` return does not bump `requestRef`; Escape has the
     same gap); clicking away mid-request then refocusing shows stale suggestions; the order-success
     total is the client figure, not the server's.
   - Counter sale round 2: a late lookup result is dropped with no signal to the cashier
     (`CounterPage.tsx:160-163`); an invalid typed quantity reverts silently (`CartLines.tsx:23-33`);
     the scanner's `addItem` path has no 9999 cap. Also the pre-existing 4xx branch still surfaces the
     raw server `data.error` in the UI — worth deciding deliberately.
6. `artifacts/store/src/pages/admin/CounterPage.tsx` is **248 lines**. Not a rule violation (the
   200-line limit is for new files) but it is the obvious next extraction, as its own change.
7. After M4b approval: write the build prompt. The builder must confirm the §10 columns against the
   test project before writing a query.
8. Recorded, not scheduled: regenerate `database.types.ts` from the test project (no longer
   blocked — there is no production to compare against); print CSS of the in-page receipt (needs a browser); no automated test for the till's retry path or
   for the new discard-and-start-over path; mobile filter panel stays open after "apply".

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
| `docs/archive/status/2026-11-18-afternoon.md` | 2026-11-18 afternoon — docs archived and deduplicated, CI fixed and sped up (#15-#19) |
| `docs/archive/status/2026-11-18-morning.md` | 2026-11-18 morning — agent-context modularization items A-F, `.kiro/` and `ltm/` removed |
| `docs/archive/status/2026-11-17-evening.md` | 2026-11-17 evening — the orders subtotal_azn fix and the reservations locale key |
| `docs/archive/status/2026-11-16-evening.md` | 2026-11-16 evening — three merges (storefront, counter sale, M4 follow-ups) |
| `docs/archive/status/2026-11-16-afternoon.md` | 2026-11-16 afternoon |
| `docs/archive/status/2026-11-16-morning.md` | 2026-11-16 morning |
| `docs/archive/status/2026-11-15.md` | 2026-11-15 — M4 |
| `docs/archive/status/2026-11-13.md` | 2026-11-13, and the 2026-11-10 first fully green CI |
| `docs/archive/status/phase-state-m1-m4.md` | M1-M4 phase state and the long numbered technical open list |
