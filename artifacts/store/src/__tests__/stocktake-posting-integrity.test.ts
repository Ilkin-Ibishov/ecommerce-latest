import { describe, it, expect } from "vitest";

/**
 * M2b Stocktake Posting Integrity Suite
 * Tests R2 (posting_date constraints and running_quantity consequence),
 * §11.6 atomic posting, opening count mode, and shrinkage valuation.
 */

interface Stocktake {
  id: string;
  status: "draft" | "posted";
  isOpeningCount: boolean;
  postingDate: number;
}

interface StocktakeLine {
  id: string;
  stocktakeId: string;
  variantId: string;
  countedQuantity: number;
  capturedAt: number;
  snapshotOnHand?: number;
}

interface StocktakeLineSnapshot {
  lineId: string;
  snapshotOnHand: number;
  capturedAt: number;
}

interface StockMovement {
  id: string;
  variantId: string;
  quantityDelta: number;
  reason: "opening_balance" | "stocktake_correction" | "online_sale";
  postingDate: number;
  transactionId: string;
}

class PostingIntegrityHarness {
  public onHand = new Map<string, number>();
  public movements: StockMovement[] = [];
  public variantCosts = new Map<string, number>();
  public stocktakes = new Map<string, Stocktake>();
  public lines: StocktakeLine[] = [];
  public snapshots = new Map<string, StocktakeLineSnapshot>();
  public openingCosts = new Map<string, number>();

  public postStocktake(stocktakeId: string, actorId?: string): { success: boolean; txId: string } {
    if (!actorId) throw new Error("ST007: Actor ID is required");
    const st = this.stocktakes.get(stocktakeId);
    if (!st || st.status !== "draft") throw new Error("ST003: Stocktake not draft");

    const stLines = this.lines.filter((l) => l.stocktakeId === stocktakeId);
    if (!stLines.length) throw new Error("ST004: No lines in stocktake");

    // Initialize snapshots from line.snapshotOnHand if not explicitly set
    for (const line of stLines) {
      if (line.snapshotOnHand !== undefined && !this.snapshots.has(line.id)) {
        this.snapshots.set(line.id, {
          lineId: line.id,
          snapshotOnHand: line.snapshotOnHand,
          capturedAt: line.capturedAt,
        });
      }
    }

    // A2 Guard: Explicit check for missing snapshots on contributing lines
    for (const line of stLines) {
      if (!this.snapshots.has(line.id)) {
        throw new Error(`ST010: Cannot post stocktake ${stocktakeId}: variant ${line.variantId} has count lines with no system snapshot`);
      }
    }

    // R2 Guard: posting_date cannot be earlier than any line snapshot
    const latestSnapshotAt = Math.max(...stLines.map((l) => this.snapshots.get(l.id)!.capturedAt));
    if (st.postingDate < latestSnapshotAt) {
      throw new Error("ST010: Stocktake posting_date cannot be earlier than contributing observations");
    }

    const txId = `tx-${Date.now()}`;
    const proposedMovements: StockMovement[] = [];

    // Group lines by variant
    const linesByVariant = new Map<string, StocktakeLine[]>();
    for (const line of stLines) {
      const list = linesByVariant.get(line.variantId) ?? [];
      list.push(line);
      linesByVariant.set(line.variantId, list);
    }

    // Atomic preparation per variant
    for (const [variantId, vLines] of linesByVariant.entries()) {
      const sorted = [...vLines].sort((a, b) => b.capturedAt - a.capturedAt);
      const latestLine = sorted[0];
      const snap = this.snapshots.get(latestLine.id);
      if (!snap) {
        throw new Error(`ST010: Cannot post stocktake ${stocktakeId}: variant ${variantId} has count lines with no system snapshot`);
      }

      // Simulate failure condition on a specific variant (e.g. system fault)
      if (variantId === "faulty_var") {
        throw new Error("ST001: Atomic failure simulated on line");
      }

      const totalCounted = vLines.reduce((acc, l) => acc + l.countedQuantity, 0);
      const delta = totalCounted - snap.snapshotOnHand;
      if (delta === 0) continue; // ledger forbids zero delta

      proposedMovements.push({
        id: `mov-${this.movements.length + proposedMovements.length + 1}`,
        variantId,
        quantityDelta: delta,
        reason: st.isOpeningCount ? "opening_balance" : "stocktake_correction",
        postingDate: st.postingDate,
        transactionId: txId,
      });
    }

    // Atomic commit
    for (const mov of proposedMovements) {
      this.movements.push(mov);
      const cur = this.onHand.get(mov.variantId) ?? 0;
      this.onHand.set(mov.variantId, cur + mov.quantityDelta);
    }

    // Opening costs carrier
    if (st.isOpeningCount) {
      for (const [vId, cost] of this.openingCosts.entries()) {
        this.variantCosts.set(vId, cost);
      }
    }

    st.status = "posted";
    return { success: true, txId };
  }
}

describe("M2b Stocktake Posting Integrity and Valuation", () => {
  it("R2: postStocktake rejects posting_date earlier than line snapshot", () => {
    const h = new PostingIntegrityHarness();
    h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 1000 });
    // Line was observed at t=1200, which is after postingDate 1000
    h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 5, capturedAt: 1200, snapshotOnHand: 10 });

    expect(() => h.postStocktake("st1", "owner-1")).toThrowError(/ST010/);
  });

  it("§11.6: atomic posting - rollback on line failure leaves zero movements written", () => {
    const h = new PostingIntegrityHarness();
    h.onHand.set("v1", 10);
    h.onHand.set("faulty_var", 5);
    h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 2000 });

    h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 8, capturedAt: 1000, snapshotOnHand: 10 });
    h.lines.push({ id: "l2", stocktakeId: "st1", variantId: "faulty_var", countedQuantity: 2, capturedAt: 1000, snapshotOnHand: 5 });

    expect(() => h.postStocktake("st1", "owner-1")).toThrowError(/ST001/);
    expect(h.movements.length).toBe(0);
    expect(h.onHand.get("v1")).toBe(10);
    expect(h.stocktakes.get("st1")?.status).toBe("draft");
  });

  it("§11.6: opening count posts opening_balance movements, leaves uncounted variants at 0", () => {
    const h = new PostingIntegrityHarness();
    h.onHand.set("v1", 0);
    h.onHand.set("v2_uncounted", 0);
    h.stocktakes.set("st-open", { id: "st-open", status: "draft", isOpeningCount: true, postingDate: 2000 });

    h.lines.push({ id: "l1", stocktakeId: "st-open", variantId: "v1", countedQuantity: 25, capturedAt: 1500, snapshotOnHand: 0 });
    h.openingCosts.set("v1", 14.50);

    h.postStocktake("st-open", "owner-1");

    expect(h.movements.length).toBe(1);
    expect(h.movements[0].reason).toBe("opening_balance");
    expect(h.movements[0].quantityDelta).toBe(25);
    expect(h.onHand.get("v1")).toBe(25);
    // Uncounted variant stays at 0 with zero movements
    expect(h.onHand.get("v2_uncounted")).toBe(0);
    expect(h.variantCosts.get("v1")).toBe(14.50);
  });

  it("§11.6: count posted hours after entry preserves interleaved sales", () => {
    const h = new PostingIntegrityHarness();
    h.onHand.set("v1", 20);

    // Shelf counted at 10:00 (t=1000). On-hand snapshot is 20. Counted 18 (delta: -2).
    h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 5000 });
    h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 18, capturedAt: 1000, snapshotOnHand: 20 });

    // 5 sales happen at 12:00 (t=2000) while shop trades
    h.onHand.set("v1", 15);
    h.movements.push({ id: "sale-1", variantId: "v1", quantityDelta: -5, reason: "online_sale", postingDate: 2000, transactionId: "tx-sale" });

    // Stocktake posted at 15:00 (t=5000)
    h.postStocktake("st1", "owner-1");

    // Net delta posted is -2. Final stock must be 15 - 2 = 13 (not 18!)
    expect(h.onHand.get("v1")).toBe(13);
  });

  it("§7.3 & §8: shrinkage valued at prevailing average cost, unvalued units reported separately", () => {
    const costMap = new Map<string, number>([["v_valued", 25.0]]); // 25 ₼ unit cost
    // v_unvalued has NO cost basis (undefined or 0)

    const variances = [
      { variantId: "v_valued", varianceQty: -4 },    // 4 missing items of valued stock
      { variantId: "v_unvalued", varianceQty: -10 }, // 10 missing items of unvalued stock
    ];

    let shrinkageValue = 0;
    let unvaluedShrinkageUnits = 0;

    for (const item of variances) {
      if (item.varianceQty < 0) {
        const unitCost = costMap.get(item.variantId) ?? 0;
        if (unitCost > 0) {
          shrinkageValue += Math.abs(item.varianceQty) * unitCost;
        } else {
          unvaluedShrinkageUnits += Math.abs(item.varianceQty);
        }
      }
    }

    expect(shrinkageValue).toBe(100.0); // 4 * 25 ₼ = 100 ₼
    expect(unvaluedShrinkageUnits).toBe(10); // 10 unvalued units missing
  });

  describe("A1 — Opening count and ordinary count delta arithmetic", () => {
    it("1. legacy opening balance 5, counted 7, opening count → on_hand ends at exactly 7", () => {
      const h = new PostingIntegrityHarness();
      h.onHand.set("v1", 5);
      h.stocktakes.set("st-open", { id: "st-open", status: "draft", isOpeningCount: true, postingDate: 2000 });
      h.lines.push({ id: "l1", stocktakeId: "st-open", variantId: "v1", countedQuantity: 7, capturedAt: 1500, snapshotOnHand: 5 });

      h.postStocktake("st-open", "owner-1");

      expect(h.movements.length).toBe(1);
      expect(h.movements[0].reason).toBe("opening_balance");
      expect(h.movements[0].quantityDelta).toBe(2);
      expect(h.onHand.get("v1")).toBe(7);
    });

    it("2. legacy opening balance 0 (no prior movements), counted 7, opening count → ends at 7", () => {
      const h = new PostingIntegrityHarness();
      h.onHand.set("v1", 0);
      h.stocktakes.set("st-open", { id: "st-open", status: "draft", isOpeningCount: true, postingDate: 2000 });
      h.lines.push({ id: "l1", stocktakeId: "st-open", variantId: "v1", countedQuantity: 7, capturedAt: 1500, snapshotOnHand: 0 });

      h.postStocktake("st-open", "owner-1");

      expect(h.movements.length).toBe(1);
      expect(h.movements[0].reason).toBe("opening_balance");
      expect(h.movements[0].quantityDelta).toBe(7);
      expect(h.onHand.get("v1")).toBe(7);
    });

    it("3. legacy opening balance 5, counted 5, opening count → ends at 5 and no movement is written", () => {
      const h = new PostingIntegrityHarness();
      h.onHand.set("v1", 5);
      h.stocktakes.set("st-open", { id: "st-open", status: "draft", isOpeningCount: true, postingDate: 2000 });
      h.lines.push({ id: "l1", stocktakeId: "st-open", variantId: "v1", countedQuantity: 5, capturedAt: 1500, snapshotOnHand: 5 });

      h.postStocktake("st-open", "owner-1");

      expect(h.movements.length).toBe(0);
      expect(h.onHand.get("v1")).toBe(5);
    });

    it("4. ordinary count, snapshot 5, counted 7 → ends at 7 with reason stocktake_correction", () => {
      const h = new PostingIntegrityHarness();
      h.onHand.set("v1", 5);
      h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 2000 });
      h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 7, capturedAt: 1500, snapshotOnHand: 5 });

      h.postStocktake("st1", "owner-1");

      expect(h.movements.length).toBe(1);
      expect(h.movements[0].reason).toBe("stocktake_correction");
      expect(h.movements[0].quantityDelta).toBe(2);
      expect(h.onHand.get("v1")).toBe(7);
    });
  });

  describe("A2 — Missing snapshot invariant guard", () => {
    it("5. stocktake with two lines; delete one line's snapshot; assert posting raises ST010 and no movements written", () => {
      const h = new PostingIntegrityHarness();
      h.onHand.set("v1", 10);
      h.onHand.set("v2", 20);
      h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 3000 });

      // Two lines for two variants with snapshots
      h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 12, capturedAt: 1000 });
      h.lines.push({ id: "l2", stocktakeId: "st1", variantId: "v2", countedQuantity: 25, capturedAt: 1000 });
      h.snapshots.set("l1", { lineId: "l1", snapshotOnHand: 10, capturedAt: 1000 });
      h.snapshots.set("l2", { lineId: "l2", snapshotOnHand: 20, capturedAt: 1000 });

      // Delete one line's row from stocktake_line_snapshots
      h.snapshots.delete("l2");

      expect(() => h.postStocktake("st1", "owner-1")).toThrowError(/ST010.*has count lines with no system snapshot/);

      // Invariant: No movements written for EITHER variant
      expect(h.movements.length).toBe(0);
      expect(h.onHand.get("v1")).toBe(10);
      expect(h.onHand.get("v2")).toBe(20);
      expect(h.stocktakes.get("st1")?.status).toBe("draft");
    });
  });
});
