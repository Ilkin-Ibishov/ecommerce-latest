# Project status — current state only

Last updated: 2026-11-18 night. The entry point for
a new session: what is true now,
what is open, and what waits on the owner. Superseded handoffs live in `docs/archive/status/`;
how work runs here lives in `docs/agent-workflow.md`. Everything referenced lives in this
repository; nothing important is only in a chat transcript.

## Start here — first thing to do in a new session (2026-11-18, night)

**`main` is green at `84ea1c3`** (both CI runs success). No open PR. Two phase branches are pushed,
built and **not yet audited**:

```bash
gh run list -b main -L 2 --json name,conclusion,headSha       # expect success at 84ea1c3 or later
git fetch -q origin && git log --oneline origin/main..origin/phase/m4b-store-notifications
git log --oneline origin/main..origin/phase/delivery-cost
```

The one permanent skip: `tests/e2e/super-admin-platform.spec.ts:4` (needs `SUPER_ADMIN_E2E`).
**Read `.claude/skills/session-start/SKILL.md` for your role.** No production project exists
(`docs/knowledgebase/supabase-projects.md`). The owner delegated design-note review and git
mechanics to the architect; product decisions stay the owner's.

### Do this first, in this order

1. **Accept M4b** — `phase/m4b-store-notifications` at `b3b01b5`, AGY round 1 (resumed once after a
   network outage) finished with exit 0. Run the `builder-round-accept` checklist against
   `git diff origin/main...origin/phase/m4b-store-notifications`; notes file
   `docs/audits/m4b-store-notifications-notes.md` (the builder's, unchecked). Then apply
   `supabase/migrations/20261118130000_m4b_admin_inbox_seen.sql` to the test project (the owner's
   yes for this phase's migrations was given 2026-11-18), open the PR, get CI green, merge, and run a
   clean-context adversarial audit (spec + diff + invariants only — it found 2 majors in staff
   provisioning *after* merge).
2. **Accept delivery cost** — `phase/delivery-cost` at `dc6e312`, AGY round 1 (resumed once) finished
   with exit 0, every item committed and pushed; builder's notes `docs/audits/delivery-cost-notes.md`,
   unchecked. Accept it the same way, apply its four `supabase/migrations/20261118140*` migrations,
   PR, merge, audit. Read every new test closely (see `docs/agent-workflow.md` operational notes).
   Merge M4b first; both edit the three dictionaries.

### What this session put on `main` (#21–#34)

- **Staff provisioning (#30)** — admin can add staff by phone, change roles; admin shell open to
  staff with a role-filtered sidebar; last-admin guard; `set_user_role` + audit line. Post-merge
  adversarial audit → **#34** fixed 6 of 7 findings (the 7th, test phones holding roles on the test
  project, is the owner's decision). Record: `docs/audits/staff-provisioning-notes.md`.
- **Fixes:** #21 sign-in no longer demotes legacy-format staff/admin; #23 CI lifts the global API
  rate limit (`E2E_DISABLE_GLOBAL_RATELIMIT`); #25 till shows "lookup failed" for errors,
  `GET /platform/notifications` is `requireAdmin`; #27 search stale suggestions; #29 till holds
  Complete during a scan, 9999 cap on scans, rejected-quantity message; #31 `CounterPage` → 165
  lines (`useCounterSale`).
- **Tests vs the 1000-row cap:** #28, #32 (backfill paged), #33 (dead-stock route `variant_ids`).
- **Design notes:** #22 reviews (staff provisioning, M4b approved; delivery-fee folded in), #26
  `docs/design-notes/delivery-cost-at-confirmation.md`.
- **Migrations applied to the test project** (via `apply_migration`, now tracked in
  `supabase_migrations`): `20261118120000`, `…120100` (without its no-op `DROP TRIGGER` line),
  `…120200`, `…150000`.
- **Branches:** remote is `main`, `fix/otp-bypass-production` (production gate — keep) and the two
  phase branches. Cleanup rules: `docs/agent-workflow.md` "Branches".

### Waiting on the owner

1. **Staff recording the delivery fee** (spec's wording) needs staff to read orders — names, phones,
   addresses, totals. Staff provisioning keeps orders admin-only. Yes/no.
2. **`AnnouncementBar`** content once its 100 AZN message goes (recommendation on record in
   `docs/archive/status/2026-11-18-evening.md`). Delivery cost leaves it untouched.
3. **Three M4 minors needing migrations** (9 reservation guard for non-tracked; 10 `FOR UPDATE` on
   the `track_stock` read in `trg_apply_stock_movement`; 13 `'in_progress'` stocktake status).
4. **Two product decisions:** M4 minor 7 (date floor for "not selling"); the dashboard `stock < 10`
   banner. **City/region field on orders** before any zone work.
5. **Repository settings:** *Automatically delete head branches* and a `main` ruleset requiring PR +
   green checks (`docs/agent-workflow.md` "Branches").

### Still open, ordered by what blocks what

1. **`StocktakeCountPage` scan is broken** (found by the audit): it reads `res.matches`, but
   `/inventory/scan` returns an array, so counting by scan finds nothing. Staff can reach the page
   since #30. Small fix, its own PR.
2. **`track_stock` — mostly stale as previously written.** Every `stock_movements` writer is
   backstopped by the ST030 trigger (`20261113231000…:19-30`). Open: the minor-10 race (unlocked
   writers: `increment_stock`, goods receipts, manual adjustment, opening balance);
   `increment_stock`, `fulfil_reservation` and goods receipts *raise* ST030 for non-tracked lines
   instead of skipping them (cancel logs "Failed to restock"); the invariant
   `no-non-tracked-variant-movements` misses schema-qualified or dropped triggers.
3. **Counter sale 4xx shows raw English server text** (some with UUIDs) to the cashier.
   Recommendation: map 401/403/429, ST001/ST002 and bundle errors to till keys, fall back to
   `errorFallback`, log the raw text.
4. Other defects from the M4b note §9 still on `main`: the order page's WhatsApp log reads a
   missing `notification_queue`; `m4-stock-signals.unit.test.ts:67-92,219-256` tests a function
   defined in the test. Older minors: `docs/archive/status/2026-11-18-evening.md`.


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
| `docs/archive/status/2026-11-18-night.md` | 2026-11-18 evening block — superseded by the night session (staff provisioning shipped and audited, #21–#34) |
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
