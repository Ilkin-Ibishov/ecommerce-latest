# M2c — Reservations and Deposits

Work order. Intent and invariants are fixed; the implementation is yours to propose.
Domain invariants: `.agents/rules/inventory.md`. Architecture: `docs/tasks/warehouse-architecture.md`.
Current state: `docs/STATUS.md`.

## 1. Why this exists

The shop takes deposits every day. A customer picks something, pays part of the price, and the goods
stay on the shelf with their name on them until they come back — sometimes days later.

Today the system cannot represent that at all, and the gap is not cosmetic. The goods are physically
present, so `on_hand` is right and must not change. But they are **not available** to the next
customer, and nothing in the system knows it. The online store will happily sell a unit that is
already promised to a walk-in, and the first anyone finds out is at packing time.

This is the last piece of M2 and the smallest of the three, but it is the one that touches the
**public storefront** — which makes it the riskiest diff in the phase.

## 2. The invariant that defines this phase

> **A reservation is not a movement.**

It does not change what is physically in the building. It reduces what may be promised to someone
else. Writing a reservation into `stock_movements` corrupts the meaning of the ledger sum, and the
architecture names it the single most expensive mistake available in this domain.

Three quantities must be distinguishable everywhere:

- **on hand** — physically present; the sum of the ledger
- **reserved** — present but promised
- **available** — on hand minus active reservations; the only number a customer may be shown

## 3. Customer context

- Deposits are a daily occurrence, taken at the counter by staff, on paper today.
- A deposit is partly paid. The owner needs to know who owes how much — but he does not need an
  accounting system, and this phase must not become one (see §6).
- Collection is open-ended. A customer may come back in three days or three weeks. **Nothing may
  auto-release a deposit someone has paid money against.**
- ~500 SKUs, 3 staff, 50–100 sales/day. Not a scale problem.
- The online store is low volume compared to walk-ins, but it is the path that can oversell silently.

## 4. The central correctness problem — read this before designing anything

`available` is derived, and derived numbers do not protect themselves.

M1's apply trigger guards `on_hand + quantity_delta >= 0`. It knows nothing about reservations. So
two things can happen today that must not:

1. An online order consumes the last unit while it is reserved for a deposit. `on_hand` stays
   non-negative, every guard passes, and the promised goods walk out the door.
2. Two online orders race for the same last available unit. The `on_hand` guard lets both through if
   on-hand covers them, because the reservation is invisible to it.

So the design must answer: **where is availability enforced, in the same transaction as the sale?**
The reservation lives in its own table, so the check is a cross-table read in the sale path — state
where it goes, what it locks, and what it costs. The decision is yours; the requirement is that an
online sale cannot consume a reserved unit, and that two concurrent sales cannot both take the last
available one.

Policy that is already decided, so do not re-litigate:

- **Online sale** that would consume a reservation: **blocked.** The customer sees the item as
  unavailable, because it is.
- **Counter sale** (M3, not built here): **warned, not blocked** — the unit is physically there, the
  customer is standing at the till, and refusing them is worse than breaking a promise the owner can
  renegotiate. When it happens it must be recorded. Build nothing for this now; design so that it
  requires no change to rows already written.

## 5. What a reservation record must answer

Design the columns and argue for them.

- Which variant, how much, and for whom. The shop has no customer accounts for walk-ins — a name and
  a phone number is what exists, and that is enough.
- Why it is held: a deposit, or a held order. A third kind, the online cart, is **out of scope** —
  leave the shape able to carry it, build nothing.
- Who took it and when.
- Its state: active, fulfilled, released, expired — and what causes each transition.
- An expiry, **nullable**. A deposit has none. See §7.
- A free-text note.

## 6. The money side, kept deliberately thin

Two numbers on the reservation: the price agreed with the customer, and how much they have paid so
far. Nothing else.

**Not** in this phase: a payments ledger, partial-payment history, refunds, customer debt across
reservations, receipts, or anything that would need an accountant's opinion. One agreed price, one
paid amount, editable by the owner only — staff may create a deposit but not change what was agreed.

If you believe the paid amount needs a history to be trustworthy, say so in the design note rather
than building one.

## 7. Expiry without a graveyard

Nothing may automatically release a paid deposit. But a reservation table with no expiry becomes a
graveyard that silently holds stock forever, and the owner will eventually wonder why his shelf and
his screen disagree.

Decided:

- Expiry is nullable. A deposit normally has none.
- Nothing is auto-released. Ever.
- `available` **excludes** a reservation whose expiry has passed, so a future cart hold stops
  blocking the moment it lapses, while a NULL-expiry deposit never lapses.
- The owner gets a list of reservations older than a threshold he can see and act on. A list, not a
  job. He chases the customer or releases it himself.

## 8. Where `available` must appear

This is the part that touches the storefront, so it is the part to be careful with.

- The public catalogue and product page show **availability**, not on-hand.
- The cart and checkout validate against availability.
- The admin inventory list shows **on hand, reserved and available as three columns.** Not one
  number. If the owner sees a single number he will not know whether a shortfall is a sale, a
  promise, or a mistake — and he will stop trusting the screen.
- Every place the storefront currently reads a quantity is a place to check. M1 moved these to
  variants; treat its call-site list as a starting point, not a complete one.

## 9. Roles

- Staff: create a deposit, record a payment against one, fulfil one, see the customer's name and
  phone.
- Owner: everything staff can do, plus release a reservation, change the agreed price, and see the
  aged list.
- Cost and margin remain owner-only, unchanged from M2a.

## 10. Open questions — answer in the design note, before any migration

1. Where availability is enforced in the sale path, what it locks, and the concurrency proof for two
   orders racing for the last available unit.
2. Whether `available` is computed on read or maintained as a column, with your reasoning. Note that
   the architecture forbids storing availability for a bundle; say whether that reasoning applies
   here.
3. The state machine: every transition, who may cause it, and what is written when it happens.
4. What happens to an active reservation when the variant's stock is corrected downward by a
   stocktake so that `on_hand` falls below what is reserved. This is not hypothetical — it is the
   normal outcome of the first real count.
5. How fulfilment interacts with the sale that completes it, given that M3's counter is not built.
6. The query shape for availability on a catalogue page listing many variants, and its indexes.
7. Whether anything in M2a's cost replay or M2b's posting needs to know about reservations. Expected:
   no. Say why, and where that is enforced.

## 11. Two questions you must answer for every rule you propose

These come from the M2b audit, where five of six findings were faithful implementations of rules that
were precise but incomplete. Both failures were avoidable at design time, and neither needed
cleverness — only these two questions:

1. **How does this rule behave in the ordinary flow?** M2b's posting-date guard was written against a
   backdating abuse and made every normal stocktake unpostable, because the ordinary flow sets the
   date before any line exists.
2. **Which earlier decision does this rule intersect?** M2b's staleness check was blind to edited
   lines because it compared creation times, while a separate, earlier decision had established that
   an edit keeps its line. Each rule was right alone and wrong together.

For every non-trivial rule in your design note, state the ordinary-flow walkthrough and the
intersections you checked. A note that does not do this will be sent back.

## 12. Deliverables, in order

1. **Design note first** at `docs/design-notes/m2c-reservations.md`, answering §10 and §11 and
   proposing the schema. Commit it and **stop** — no migrations before it is reviewed.
2. Migrations under `supabase/migrations/`, following existing naming and RLS conventions.
3. Regenerated API layer (OpenAPI → Orval → Zod). Generated files are generated, never hand-edited.
4. API routes: create, list, record payment, fulfil, release; the aged list.
5. Storefront and admin UI: availability where §8 requires it, a deposit screen staff can use at the
   counter in under a minute, and the owner's aged list.
6. Tests: a reservation never produces a movement; an online sale cannot consume a reserved unit; two
   concurrent sales cannot both take the last available unit; an expired reservation stops reducing
   availability while a NULL-expiry one does not; a stocktake correction that pushes on-hand below
   the reserved quantity behaves as the note says; staff cannot change an agreed price.
7. A new executable invariant: nothing writes a reservation into `stock_movements`, and no public
   storefront path reads `on_hand` where it should read availability.

## 13. Definition of done

- `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run audit:invariants:strict` green, baseline empty
- `main` deployable at every commit on this branch
- Every item in §12 exists, or the design note says why it should not
- `docs/audits/m2c-implementation-notes.md` written, with the real output of the three commands

## 14. Out of scope

Online cart reservations with expiry. Counter sale and its override recording (M3). Payments ledger,
refunds, customer debt, receipts. Layaway instalment schedules. Notifications or reminders to
customers. Bills of materials, locations, lot tracking.

If something here genuinely cannot be built cleanly without one of them, say so in the design note
rather than quietly expanding scope.

## 15. What is not verified

No migration in this repository has ever been executed against a real Postgres, and CI's integration
tier has been failing since July; its repair is deliberately postponed. Your SQL is checked only by a
TypeScript re-implementation of its logic. Write the migrations as if a reviewer will read them and
then run them once, in order, against a live database with no undo.
