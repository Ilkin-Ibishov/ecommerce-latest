# M3 §16 — customer answers and architect decisions

Written 2026-11-13. Answers the open customer questions in
`docs/tasks/warehouse-m3-counter-sale.md` §16. Two came from the customer; the rest are
architect recommendations researched against how commercial POS systems solve the same
problem. Each says what ships, what it costs, and what the customer could still overturn.

Status key: **ANSWERED** = the customer said this. **DECIDED** = architect's call, no
customer input needed. **ASK** = still needs the customer, question reworded below.

---

## §16.5 — Offline queue — **ANSWERED: internet does not drop**

**M3b is dropped.** §9 (snapshot cache, IndexedDB queue, reconnect sync, queued-sale
attribution, provisional receipt references) is not built.

Consequences:
- `post_counter_sale`'s `queued` parameter stays in the signature but is never set true by
  any client. Leave it — removing it is a migration for no gain, and it is the seam M3b
  would re-enter through.
- The residual-risk warning about cleared browser storage is not needed on the screen.
- Verify once with the second shop (no barcode device) before treating this as settled for
  both. A mobile-hotspot till can drop without anyone noticing it dropped.

## §16.6 — Pre-assembled boxes — **ANSWERED: few, one or two days on the shelf**

**§10's minimal bundle is enough. M4 does not need real assembly.**

Components stay "loose" in the system until the box sells; `inventory.md`'s one-unit-counted-
once invariant holds because "loose" is the one place. A stocktake during those one or two
days would need the box opened or its contents counted — acceptable at this volume and
duration.

Not built, and this is the reason to write down so it is not re-litigated: assembled-kit
stock on the parent variant, `assembly_consume` / `assembly_produce` ledger pairs, and
component cost roll-up frozen at assembly. The architecture ADR describes these; they stay
described. Revisit only if the shop starts holding assembled stock for weeks, which would
show up as repeated stocktake variance on component variants.

---

## §16.3 — Staff discount — **DECIDED: no manual discount in M3, but record the risk**

The spec default (no) ships. The research reason, not just the default:

Every commercial POS solves this the same way — a percentage cap per role, enforced
server-side, with an over-cap action requiring a manager PIN, a mandatory reason code, and
an immutable log against the authorising manager. Typical caps: staff 10%, manager 50%,
owner unlimited. The consistent advice is to grant fewer permissions, because each one has
to be trained and monitored.

Building that for a one-to-three person shop where the owner is usually present is not
worth it in M3: it needs a per-user cap column, server-side enforcement, an override flow, a
reason vocabulary, an audit view and a UI.

**But the risk of shipping a flat "no" is real and belongs in the record.** If the till
refuses a discount the owner has verbally approved, staff do not stop discounting — they
under-ring: sell nothing, or ring a cheaper item instead. That corrupts the ledger, which is
strictly worse than a recorded discount. Loss-prevention literature names under-ringing as a
standard internal-shrink mechanism.

**If the customer later asks for discounts, build visibility before permission:** a
whole-sale `discount_amount` with a required free-text reason, available to all staff, no
cap, no override flow — and every discounted sale listed in the owner's sale view. One
column plus one report line catches the actual risk (invisible discounting). Caps and
manager PINs are a second step, and only if volume justifies them.

## §16.9 — Selling at zero on hand — **DECIDED: spec default is right, keep it**

Ship `allow_negative_stock` **off** per shop, with such sales stored as `needs_owner`.

This matches what mid-market systems do and is better reasoned than the common
"just block it" setting. The physical fact wins: the customer is holding the item. Blocking
the sale produces either a lost sale or an unrecorded one, and an unrecorded sale is a
ledger corruption that no later stocktake can attribute. Sage's Retail POS names this
exactly — continue processing when the shelf has the item and the system says zero, then
notify someone to act on the adjustment. That is the `needs_owner` design.

Deliberate non-goals, so they are not added by reflex:
- **No per-item override.** Several systems offer global-plus-per-item (`yes` / `global` /
  `no` on the item master). That is a column, a UI and a third state in every availability
  check, for a case this shop has not produced.
- **No oversell ceiling.** Caps on how far below zero a variant may go are an e-commerce
  pattern for supplier-backed stock; the till is looking at the shelf.

One thing to verify rather than assume: when goods are later received for a variant that
went negative, the receipt must settle the negative correctly and the cost projection must
replay without a negative basis. `m2a_replay_negative_basis` and
`m3a-negative-stock.serial.test.ts` exist; confirm they cover receipt-after-negative, not
only the oversell itself.

## §16.4 — Payment methods — **DECIDED, and the spec default needs one change**

Methods: cash, card, bank transfer. Store them as rows in a lookup, not a Postgres enum —
extending an enum is a migration, and the fourth method will arrive from the customer, not
from us.

**Split payment: not in the UI, but the schema must allow it from day one.**

This is the one place the spec default ("one method per counter sale") would cost real money
later. Storing `payment_method text` on `counter_sales` is the cheap move that becomes
expensive: adding split tender later means a child table *and* rewriting every report,
day-end reconciliation and refund path that reads the column. Multi-tender is a baseline
expectation in retail rather than a premium feature, and the standard shape is one sale to
many settlement records, one per method.

**Build `counter_sale_payments` (sale_id, method, amount) now; have the till write exactly
one row.** The UI, the receipt and the day-end report are identical to the single-method
version. Split tender later becomes a screen change, not a migration plus a report rewrite.
Cost today: one table, one foreign key, a sum constraint against the sale total. This is the
same reasoning the architecture ADR applies to `numeric(14,4)` over `integer` for quantity —
pay one column now rather than rewrite history later.

Two rules to carry into the design note, both standard in split-tender implementations and
both cheap to honour even with one row:
- Lock the sale before the first payment is captured; never modify lines or prices after.
- A refund settles against the original tenders, per leg. With one row this is trivial; with
  the column it is ambiguous.

**Deposit pick-ups: record the payment.** The spec default (no payment on pick-ups) leaves
money taken at the till invisible to the day-end count, because a balance paid on collection
is real cash through the drawer. If a pick-up can involve any payment, it writes a
`counter_sale_payments` row like anything else. Confirm against M2c's fulfilment path before
the design note settles this.

## §16.10 — The shop with no barcode device — **DECIDED: search only in M3; labels are M4**

M3 ships text search alongside barcode entry, as already decided. Label printing is not in
M3 — but it is smaller than it looks and is the strongest M4 candidate for winning the
second shop.

What makes it cheap: `variant_barcodes` already exists, with `pack_quantity`. The missing
piece is a print view, not a data model. A browser-printable label sheet (Avery-style, a JS
barcode renderer, laid out from the variant list) needs no hardware purchase and no new
table. A thermal label printer is an upgrade the shop can buy later without a code change.

Constraints for whoever builds it:
- **Code 128, encoding the existing SKU or variant id.** Do not mint EAN-13 ourselves.
  GS1 reserves the 200–299 prefix range for internal use, but a self-minted EAN-13 that
  escapes the shop collides with a real product; Code 128 is the standard internal choice
  and cannot be mistaken for a manufacturer code.
- **Never generate a barcode for a product that already carries a usable one.** Map the
  supplier barcode to the variant instead. Duplicate barcodes ring up the wrong item, and
  this is the most common failure in stores that print their own labels.
- Uniqueness is enforced in the database, not in the print screen.

## §16.2 — Receipt printer and paper — **DECIDED: spec default, print on request**

Browser print, narrow-paper layout, on request. This is where regulation is heading
elsewhere — France dropped the automatic paper receipt in 2023 and Belgium made it optional
the same year, with Germany drafting the same move — so an on-request default will not need
revisiting.

Do not design around that trend, though: Azerbaijani fiscal rules are the binding
constraint, and they are §16.1. The one durable rule worth honouring either way is that a
shop offering a non-paper receipt must still have a reliable way to print one when a
customer asks, which is what §11 already describes.

## §16.7 — Deposit pick-up on the same receipt — **DECIDED: separate, as defaulted**

A pick-up fulfils an earlier reservation; it is not a new sale. Putting both on one receipt
makes the receipt total stop meaning "money taken now", which breaks day-end reconciliation
and makes a later partial refund ambiguous about which document it reverses. Keep the
document boundary. Revisit only if the shop reports customers being confused by two slips.

## §16.8 — Shared barcode across colours — **DECIDED: yes, with one refinement**

"Always ask which colour" is correct and should not be optimised away with a guess. One
refinement worth specifying, because it removes most of the cost without lying:

When a scanned barcode resolves to several variants, show the picker **with on-hand quantity
beside each variant**, and pre-select the one variant that has stock when exactly one does.
The cashier still confirms; the common case becomes one keypress instead of a decision. Do
not auto-complete the sale on a single-stocked match — that is how the wrong colour leaves
the shop.

---

## §16.11 — Things sold that are not stocked — **ASK: the question is too broad to default**

The spec defaults this to "no". That default is probably wrong for a gift shop, and the
question as worded will not surface why: owners answer "no, we only sell products" and then
charge for gift wrapping the same week. Gift-shop POS guidance treats wrapping,
personalisation and engraving as normal add-on services the till must carry and report
separately; the usual implementation is a non-physical product, or a service SKU that
deducts a pre-packed kit.

**Reworded for the customer, split so each answer is actionable:**
- Do you charge for gift wrapping, a gift card/message, engraving or delivery?
- **Do you sell gift certificates or store credit?**

The second question is the one that matters and the original wording hides it. A gift
certificate is not a product — it is a liability until redeemed, and bolting it on later
touches the ledger, the receipt and the day-end reconciliation at once. Far better to know
now and say "not in M3" deliberately than to discover it during M4.

**If the answer is yes to the first:** the M4 shape is a variant with `track_stock = false` —
it sells, appears on the receipt and earns revenue, but writes no stock movement. Note the
cost honestly: this is a branch in the ledger path, which is the most dangerous place in
this codebase to add one, and the ADR warns against exactly this kind of flag
(`has_variants`). It needs an invariant asserting that no `track_stock = false` variant ever
appears in `stock_movements`, written in the same commit.

**If the answer is yes to the second:** it is its own phase, not an M4 line item.

## §16.1 — Accountant — **ASK, unchanged, and still the only one that cannot be defaulted**

Everything above can ship on a default and be corrected cheaply. This one cannot: a receipt
that is legally insufficient is discovered after go-live, by someone other than us.

Sharpen the ask to what changes the build: must the receipt carry a VÖEN, a shop address or
any other named field, and is a non-fiscal printed receipt acceptable for a retail shop in
Azerbaijan? §11 says any required fields are added to the receipt and nowhere else, so a
written answer converts directly into one change.

---

## What this changes in the plan

| Was | Now |
|---|---|
| M3b (offline queue) pending §16.5 | **Dropped** |
| M4 scope pending §16.6 | **No real assembly.** M4 is free for alerts, reorder, labels |
| `payment_method` column on `counter_sales` | **`counter_sale_payments` child table**, one row written |
| Deposit pick-up records no payment | **Records one**, pending an M2c check |
| §16.11 defaulted to "no" | **Re-ask**, split into services and gift certificates |

Open for the customer: §16.1 (accountant, in writing) and §16.11 as reworded. Everything
else ships on the decisions above.

### Sources consulted
Role-based POS permissions and discount caps: eposly.io, vitepos.com, koronapos.com,
maduuka.com, tabres.com. Negative stock: Sage Retail POS KB, DealPOS, SalesPlay, Candela
RMS, tenthplanet. Split tender: sensepass.com, Lightspeed/ShopKeep tender settings,
pospaynews.com. Internal barcodes: kladana.com, inflowinventory.com, stockflowsystems.com,
sandooq.app. Digital vs paper receipts: EuroShop (Loi AGEC, Belgian and German rule
changes), Star Micronics. Gift-shop services: posterita.com, koronapos.com, Shopify.
