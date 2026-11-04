import { describe, it, expect } from "vitest";

/**
 * M2a Costing Engine Replay & Theorem Verification
 *
 * Implements:
 * 1. Partial Replay equals Full Replay (Inductive Equivalence Theorem)
 * 2. Backdated goods receipt updates historical sale valued cost
 * 3. Opening balance without opening_cost excluded from weighted average
 * 4. Opening balance with opening_cost establishes initial basis
 * 5. Deterministic replay ordering: (posting_date ASC, created_at ASC, movement_id ASC)
 */

export interface PhysicalMovement {
  id: string;
  variant_id: string;
  posting_date: string;
  created_at: string;
  quantity_delta: number;
  reason: "goods_receipt" | "online_sale" | "counter_sale" | "customer_return" | "opening_balance" | "return_to_supplier" | "manual_adjustment";
  reference_type?: string;
  reference_id?: string;
  receipt_unit_cost?: number;
}

export interface ValuationRecord {
  movement_id: string;
  variant_id: string;
  posting_date: string;
  created_at: string;
  quantity_delta: number;
  unit_cost: number;
  total_cost: number;
  running_quantity: number;
  running_cost_basis_qty: number;
  running_avg_cost: number;
  has_unknown_cost_basis: boolean;
}

export function compareOrder(a: { posting_date: string; created_at: string; id: string }, b: { posting_date: string; created_at: string; id: string }): number {
  if (a.posting_date !== b.posting_date) return a.posting_date.localeCompare(b.posting_date);
  if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
  return a.id.localeCompare(b.id);
}

export class PureCostEngine {
  public records: ValuationRecord[] = [];
  public costPriceCache: number = 0;

  constructor(public openingCost?: number) {}

  public recompute(movements: PhysicalMovement[], fromDate?: string): void {
    let qty = 0;
    let basisQty = 0;
    let avgCost = 0;
    let hasUnknown = false;

    if (fromDate) {
      const carried = this.records
        .filter((r) => r.posting_date < fromDate)
        .sort((a, b) => compareOrder({ posting_date: a.posting_date, created_at: a.created_at, id: a.movement_id }, { posting_date: b.posting_date, created_at: b.created_at, id: b.movement_id }));

      const anchor = carried[carried.length - 1];
      if (anchor) {
        qty = anchor.running_quantity;
        basisQty = anchor.running_cost_basis_qty;
        avgCost = anchor.running_avg_cost;
        hasUnknown = anchor.has_unknown_cost_basis;
      }
      this.records = carried;
    } else {
      this.records = [];
    }

    const replayed = movements
      .filter((m) => !fromDate || m.posting_date >= fromDate)
      .sort(compareOrder);

    for (const m of replayed) {
      let unitCost = 0;
      let totalCost = 0;

      if (m.reason === "goods_receipt") {
        unitCost = m.receipt_unit_cost ?? 0;
        totalCost = Number((m.quantity_delta * unitCost).toFixed(2));
        if (basisQty <= 0) {
          avgCost = unitCost;
          basisQty = m.quantity_delta;
        } else {
          avgCost = ((basisQty * avgCost) + (m.quantity_delta * unitCost)) / (basisQty + m.quantity_delta);
          basisQty = basisQty + m.quantity_delta;
        }
        qty = qty + m.quantity_delta;
      } else if (m.reason === "opening_balance") {
        if (this.openingCost != null && this.openingCost > 0) {
          unitCost = this.openingCost;
          totalCost = Number((m.quantity_delta * unitCost).toFixed(2));
          if (basisQty <= 0) {
            avgCost = unitCost;
            basisQty = m.quantity_delta;
          } else {
            avgCost = ((basisQty * avgCost) + (m.quantity_delta * unitCost)) / (basisQty + m.quantity_delta);
            basisQty = basisQty + m.quantity_delta;
          }
          hasUnknown = false;
        } else {
          unitCost = 0;
          totalCost = 0;
          hasUnknown = true;
        }
        qty = qty + m.quantity_delta;
      } else if (m.reason === "customer_return") {
        let returnUnitCost: number | null = null;
        if (m.reference_type === "order" && m.reference_id) {
          const priorSales = this.records
            .filter((r) => {
              const origM = movements.find((x) => x.id === r.movement_id);
              return origM && origM.reference_type === "order" && origM.reference_id === m.reference_id &&
                (origM.reason === "online_sale" || origM.reason === "counter_sale") &&
                compareOrder(origM, m) < 0;
            })
            .sort((a, b) => compareOrder({ posting_date: a.posting_date, created_at: a.created_at, id: a.movement_id }, { posting_date: b.posting_date, created_at: b.created_at, id: b.movement_id }));
          const orig = priorSales[priorSales.length - 1];
          if (orig) returnUnitCost = orig.unit_cost;
        }
        unitCost = returnUnitCost ?? avgCost;
        totalCost = Number((m.quantity_delta * unitCost).toFixed(2));
        if (basisQty <= 0) {
          avgCost = unitCost;
          basisQty = m.quantity_delta;
        } else {
          avgCost = ((basisQty * avgCost) + (m.quantity_delta * unitCost)) / (basisQty + m.quantity_delta);
          basisQty = basisQty + m.quantity_delta;
        }
        qty = qty + m.quantity_delta;
      } else {
        unitCost = avgCost;
        totalCost = Number((Math.abs(m.quantity_delta) * unitCost).toFixed(2));
        qty = qty + m.quantity_delta;
        basisQty = Math.max(0, basisQty + m.quantity_delta);
        if (basisQty === 0 && qty > 0) hasUnknown = true;
      }

      this.records.push({
        movement_id: m.id,
        variant_id: m.variant_id,
        posting_date: m.posting_date,
        created_at: m.created_at,
        quantity_delta: m.quantity_delta,
        unit_cost: Number(unitCost.toFixed(4)),
        total_cost: totalCost,
        running_quantity: qty,
        running_cost_basis_qty: basisQty,
        running_avg_cost: Number(avgCost.toFixed(4)),
        has_unknown_cost_basis: hasUnknown,
      });
    }

    this.costPriceCache = Number(avgCost.toFixed(2));
  }
}

describe("M2a Costing Engine Replay", () => {
  it("theorem: partial replay equals full replay across interleaved timeline", () => {
    const movements: PhysicalMovement[] = [
      { id: "m-01", variant_id: "v1", posting_date: "2026-11-01T08:00:00Z", created_at: "2026-11-01T08:00:00Z", quantity_delta: 20, reason: "goods_receipt", receipt_unit_cost: 10.0 },
      { id: "m-02", variant_id: "v1", posting_date: "2026-11-02T10:00:00Z", created_at: "2026-11-02T10:00:00Z", quantity_delta: -5, reason: "online_sale", reference_type: "order", reference_id: "ord-1" },
      { id: "m-03", variant_id: "v1", posting_date: "2026-11-03T09:00:00Z", created_at: "2026-11-03T09:00:00Z", quantity_delta: 15, reason: "goods_receipt", receipt_unit_cost: 14.0 },
      { id: "m-04", variant_id: "v1", posting_date: "2026-11-04T12:00:00Z", created_at: "2026-11-04T12:00:00Z", quantity_delta: -8, reason: "online_sale", reference_type: "order", reference_id: "ord-2" },
      { id: "m-05", variant_id: "v1", posting_date: "2026-11-05T14:00:00Z", created_at: "2026-11-05T14:00:00Z", quantity_delta: 2, reason: "customer_return", reference_type: "order", reference_id: "ord-2" },
      { id: "m-06", variant_id: "v1", posting_date: "2026-11-06T11:00:00Z", created_at: "2026-11-06T11:00:00Z", quantity_delta: -3, reason: "counter_sale" },
    ];

    const engineFull = new PureCostEngine();
    engineFull.recompute(movements);

    const cutoff = "2026-11-04T00:00:00Z";
    const enginePartial = new PureCostEngine();
    // Pre-populate before cutoff
    enginePartial.recompute(movements.filter((m) => m.posting_date < cutoff));
    // Now replay from cutoff forward
    enginePartial.recompute(movements, cutoff);

    expect(enginePartial.records).toHaveLength(engineFull.records.length);
    for (let i = 0; i < engineFull.records.length; i++) {
      const fullRec = engineFull.records[i];
      const partRec = enginePartial.records[i];
      expect(partRec).toEqual(fullRec);
    }
    expect(enginePartial.costPriceCache).toBe(engineFull.costPriceCache);
  });

  it("backdated receipt changes the valued cost of an already-posted sale", () => {
    const movements: PhysicalMovement[] = [
      { id: "m-10", variant_id: "v2", posting_date: "2026-11-01T08:00:00Z", created_at: "2026-11-01T08:00:00Z", quantity_delta: 10, reason: "goods_receipt", receipt_unit_cost: 5.0 },
      { id: "m-20", variant_id: "v2", posting_date: "2026-11-03T10:00:00Z", created_at: "2026-11-03T10:00:00Z", quantity_delta: -4, reason: "online_sale" },
    ];

    const engine = new PureCostEngine();
    engine.recompute(movements);

    const saleBefore = engine.records.find((r) => r.movement_id === "m-20")!;
    expect(saleBefore.unit_cost).toBe(5.0);
    expect(saleBefore.total_cost).toBe(20.0);

    // Insert backdated receipt on Nov 2 (between m-10 and m-20)
    movements.push({
      id: "m-15",
      variant_id: "v2",
      posting_date: "2026-11-02T08:00:00Z",
      created_at: "2026-11-04T12:00:00Z", // Entered later
      quantity_delta: 10,
      reason: "goods_receipt",
      receipt_unit_cost: 9.0,
    });

    engine.recompute(movements, "2026-11-02T08:00:00Z");

    const saleAfter = engine.records.find((r) => r.movement_id === "m-20")!;
    // (10 * 5 + 10 * 9) / 20 = 7.00
    expect(saleAfter.unit_cost).toBe(7.0);
    expect(saleAfter.total_cost).toBe(28.0);
  });

  it("opening balance with no opening_cost is excluded from average, not averaged as zero", () => {
    const movements: PhysicalMovement[] = [
      { id: "m-30", variant_id: "v3", posting_date: "2026-11-01T08:00:00Z", created_at: "2026-11-01T08:00:00Z", quantity_delta: 50, reason: "opening_balance" },
      { id: "m-31", variant_id: "v3", posting_date: "2026-11-02T08:00:00Z", created_at: "2026-11-02T08:00:00Z", quantity_delta: 10, reason: "goods_receipt", receipt_unit_cost: 10.0 },
    ];

    const engineWithoutCost = new PureCostEngine(undefined);
    engineWithoutCost.recompute(movements);

    const receiptRec = engineWithoutCost.records.find((r) => r.movement_id === "m-31")!;
    // Running avg should be 10.0, NOT (10 * 10) / (50 + 10) = 1.67
    expect(receiptRec.running_avg_cost).toBe(10.0);
    expect(receiptRec.running_cost_basis_qty).toBe(10);
    expect(receiptRec.running_quantity).toBe(60);

    const engineWithCost = new PureCostEngine(6.0);
    engineWithCost.recompute(movements);
    const receiptRecWithCost = engineWithCost.records.find((r) => r.movement_id === "m-31")!;
    // (50 * 6 + 10 * 10) / 60 = 400 / 60 = 6.6667
    expect(receiptRecWithCost.running_avg_cost).toBe(6.6667);
    expect(receiptRecWithCost.running_cost_basis_qty).toBe(60);
  });
});
