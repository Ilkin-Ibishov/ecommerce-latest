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
  postingDate?: number | null;
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

interface StocktakeResolution {
  variantId: string;
  resolutionType: "sum" | "override";
  resolvedQuantity: number;
  resolvedLineCount: number;
  resolvedLatestLineAt: number;
  chosenLineId?: string;
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
  public resolutions = new Map<string, StocktakeResolution>();
  public openingCosts = new Map<string, number>();

  public resolveVariant(
    variantId: string,
    resolutionType: "sum" | "override",
    resolvedQuantity: number,
    stocktakeId?: string,
    chosenLineId?: string,
  ): void {
    const targetStId = stocktakeId ?? this.lines.find((l) => l.variantId === variantId)?.stocktakeId;
    const vLines = this.lines.filter((l) => l.variantId === variantId && (!targetStId || l.stocktakeId === targetStId));
    const count = vLines.length;
    const latestAt = count > 0 ? Math.max(...vLines.map((l) => l.capturedAt)) : 0;
    this.resolutions.set(variantId, {
      variantId,
      resolutionType,
      resolvedQuantity,
      resolvedLineCount: count,
      resolvedLatestLineAt: latestAt,
      chosenLineId,
    });
  }

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

    const effectivePostingDate = st.postingDate ?? Date.now();

    // R2 Guard: posting_date cannot be earlier than any line snapshot (only when explicitly set)
    const latestSnapshotAt = Math.max(...stLines.map((l) => this.snapshots.get(l.id)!.capturedAt));
    if (st.postingDate != null && st.postingDate < latestSnapshotAt) {
      throw new Error("ST010: Stocktake posting_date cannot be earlier than contributing observations");
    }

    // A4 Guard: Verify resolutions are not stale (ST011)
    for (const [variantId, res] of this.resolutions.entries()) {
      const vLines = stLines.filter((l) => l.variantId === variantId);
      const curCount = vLines.length;
      const curLatestAt = curCount > 0 ? Math.max(...vLines.map((l) => l.capturedAt)) : 0;
      if (curCount !== res.resolvedLineCount || curLatestAt > res.resolvedLatestLineAt) {
        throw new Error(`ST011: Cannot post stocktake ${stocktakeId}: resolution for variant ${variantId} is stale - lines changed after it was recorded`);
      }
    }

    // F2 Guard: Override resolution must specify chosen_line_id (ST013)
    for (const [variantId, res] of this.resolutions.entries()) {
      if (res.resolutionType === "override" && !res.chosenLineId) {
        throw new Error(`ST013: Cannot post stocktake ${stocktakeId}: variant ${variantId} has override resolution with no chosen line`);
      }
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
      const res = this.resolutions.get(variantId);
      let snap: StocktakeLineSnapshot | undefined;
      if (res && res.resolutionType === "override" && res.chosenLineId) {
        snap = this.snapshots.get(res.chosenLineId);
      } else {
        const sorted = [...vLines].sort((a, b) => b.capturedAt - a.capturedAt);
        const latestLine = sorted[0];
        snap = this.snapshots.get(latestLine.id);
      }
      if (!snap) {
        throw new Error(`ST010: Cannot post stocktake ${stocktakeId}: variant ${variantId} has count lines with no system snapshot`);
      }

      // Simulate failure condition on a specific variant (e.g. system fault)
      if (variantId === "faulty_var") {
        throw new Error("ST001: Atomic failure simulated on line");
      }

      const totalCounted = vLines.reduce((acc, l) => acc + l.countedQuantity, 0);
      let effectiveCounted = totalCounted;
      if (res) {
        effectiveCounted = res.resolvedQuantity;
      }
      const delta = effectiveCounted - snap.snapshotOnHand;
      if (delta === 0) continue; // ledger forbids zero delta

      proposedMovements.push({
        id: `mov-${this.movements.length + proposedMovements.length + 1}`,
        variantId,
        quantityDelta: delta,
        reason: st.isOpeningCount ? "opening_balance" : "stocktake_correction",
        postingDate: effectivePostingDate,
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

    st.postingDate = effectivePostingDate;
    st.status = "posted";
    return { success: true, txId };
  }
}

describe("M2b Stocktake Posting Integrity and Valuation", () => {
  it("F1: ordinary flow with no posting_date succeeds and movements carry posting moment", () => {
    const h = new PostingIntegrityHarness();
    const t0 = Date.now();
    // Created with no posting_date
    h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false });
    // Line scanned later with snapshot captured at t0 + 500
    h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 8, capturedAt: t0 + 500, snapshotOnHand: 10 });

    const res = h.postStocktake("st1", "owner-1");
    expect(res.success).toBe(true);
    const st = h.stocktakes.get("st1");
    expect(st?.status).toBe("posted");
    expect(st?.postingDate).toBeDefined();
    expect(st?.postingDate).toBeGreaterThanOrEqual(t0);
    expect(h.movements.length).toBe(1);
    expect(h.movements[0].postingDate).toBe(st?.postingDate);
    expect(h.movements[0].quantityDelta).toBe(-2);
  });

  it("F1 / R2: postStocktake rejects explicit owner posting_date earlier than line snapshot", () => {
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

  describe("A3 — Counted-zero line clears non-zero quantity", () => {
    it("6. on-hand 5 from legacy opening balance, counted 0, opening count → single movement of -5 and on_hand ends at 0", () => {
      const h = new PostingIntegrityHarness();
      h.onHand.set("v1", 5);
      h.stocktakes.set("st-open", { id: "st-open", status: "draft", isOpeningCount: true, postingDate: 2000 });
      h.lines.push({ id: "l1", stocktakeId: "st-open", variantId: "v1", countedQuantity: 0, capturedAt: 1500, snapshotOnHand: 5 });

      h.postStocktake("st-open", "owner-1");

      expect(h.movements.length).toBe(1);
      expect(h.movements[0].reason).toBe("opening_balance");
      expect(h.movements[0].quantityDelta).toBe(-5);
      expect(h.onHand.get("v1")).toBe(0);
    });

    it("7. on-hand 5, counted 0, ordinary count → single movement of -5 with reason stocktake_correction and on_hand ends at 0", () => {
      const h = new PostingIntegrityHarness();
      h.onHand.set("v1", 5);
      h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 2000 });
      h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 0, capturedAt: 1500, snapshotOnHand: 5 });

      h.postStocktake("st1", "owner-1");

      expect(h.movements.length).toBe(1);
      expect(h.movements[0].reason).toBe("stocktake_correction");
      expect(h.movements[0].quantityDelta).toBe(-5);
      expect(h.onHand.get("v1")).toBe(0);
    });
  });

  describe("A4 — Resolution staleness detection (ST011)", () => {
    it("8. three-step sequence: resolve, add a late scan, attempt to post asserts ST011 and zero movements written", () => {
      const h = new PostingIntegrityHarness();
      h.onHand.set("v1", 20);
      h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 5000 });

      // Step 1: Two counters scan same shelf at 15:00 (t=1000 and t=1010)
      h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 10, capturedAt: 1000 });
      h.lines.push({ id: "l2", stocktakeId: "st1", variantId: "v1", countedQuantity: 5, capturedAt: 1010 });
      h.snapshots.set("l1", { lineId: "l1", snapshotOnHand: 20, capturedAt: 1000 });
      h.snapshots.set("l2", { lineId: "l2", snapshotOnHand: 20, capturedAt: 1010 });

      // Owner resolves at 15:00 with sum (15)
      h.resolveVariant("v1", "sum", 15, "st1");

      // Step 2: Third counter finishes back room at 15:10 (t=1510) and adds scan of 4
      h.lines.push({ id: "l3", stocktakeId: "st1", variantId: "v1", countedQuantity: 4, capturedAt: 1510 });
      h.snapshots.set("l3", { lineId: "l3", snapshotOnHand: 20, capturedAt: 1510 });

      // Step 3: Posting at 15:20 blocks with ST011 and writes no movements
      expect(() => h.postStocktake("st1", "owner-1")).toThrowError(/ST011.*resolution for variant v1 is stale - lines changed after it was recorded/);
      expect(h.movements.length).toBe(0);
      expect(h.onHand.get("v1")).toBe(20);
      expect(h.stocktakes.get("st1")?.status).toBe("draft");
    });

    it("9. re-resolve after late scan asserts posting succeeds with quantity including late scan", () => {
      const h = new PostingIntegrityHarness();
      h.onHand.set("v1", 20);
      h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 5000 });

      // Two initial scans (10 + 5 = 15) resolved by owner
      h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 10, capturedAt: 1000 });
      h.lines.push({ id: "l2", stocktakeId: "st1", variantId: "v1", countedQuantity: 5, capturedAt: 1010 });
      h.snapshots.set("l1", { lineId: "l1", snapshotOnHand: 20, capturedAt: 1000 });
      h.snapshots.set("l2", { lineId: "l2", snapshotOnHand: 20, capturedAt: 1010 });
      h.resolveVariant("v1", "sum", 15, "st1");

      // Late scan of 4 added
      h.lines.push({ id: "l3", stocktakeId: "st1", variantId: "v1", countedQuantity: 4, capturedAt: 1510 });
      h.snapshots.set("l3", { lineId: "l3", snapshotOnHand: 20, capturedAt: 1510 });

      // Re-resolve including late scan (15 + 4 = 19)
      h.resolveVariant("v1", "sum", 19, "st1");

      // Post succeeds with quantity that includes late scan (19 - 20 = -1)
      const res = h.postStocktake("st1", "owner-1");
      expect(res.success).toBe(true);
      expect(h.movements.length).toBe(1);
      expect(h.movements[0].quantityDelta).toBe(-1);
      expect(h.movements[0].reason).toBe("stocktake_correction");
      expect(h.onHand.get("v1")).toBe(19);
      expect(h.stocktakes.get("st1")?.status).toBe("posted");
    });

    it("F2: override resolution measures against chosen line snapshot, preserving interleaved sales", () => {
      const h = new PostingIntegrityHarness();
      // Store initially has 10 units on-hand
      h.onHand.set("v1", 10);
      h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 5000 });

      // Step 1: Count 10 at 10:00 (t=1000). Snapshot on-hand is 10.
      h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 10, capturedAt: 1000 });
      h.snapshots.set("l1", { lineId: "l1", snapshotOnHand: 10, capturedAt: 1000 });

      // Step 2: Between 10:00 and 12:00, 2 units sold. Store on-hand drops to 8.
      h.onHand.set("v1", 8);
      h.movements.push({
        id: "mov-sale-1",
        variantId: "v1",
        quantityDelta: -2,
        reason: "online_sale",
        postingDate: 1100,
        transactionId: "tx-sale",
      });

      // Step 3: Rescan 6 at 12:00 (t=1200). Snapshot on-hand is 8.
      h.lines.push({ id: "l2", stocktakeId: "st1", variantId: "v1", countedQuantity: 6, capturedAt: 1200 });
      h.snapshots.set("l2", { lineId: "l2", snapshotOnHand: 8, capturedAt: 1200 });

      // Step 4: Owner overrides to line 1 (counted 10, chosen_line_id = l1)
      h.resolveVariant("v1", "override", 10, "st1", "l1");

      // Step 5: Post stocktake. Delta = counted (10) - chosen snapshot (10) = 0.
      // Store on-hand remains at 8 (the 2 sales between scans are NOT erased).
      const res = h.postStocktake("st1", "owner-1");
      expect(res.success).toBe(true);
      expect(h.onHand.get("v1")).toBe(8);
      // No stocktake_correction movement written because delta is 0
      const stocktakeMovs = h.movements.filter((m) => m.reason === "stocktake_correction");
      expect(stocktakeMovs.length).toBe(0);
    });

    it("F2: sum resolution keeps using the latest snapshot", () => {
      const h = new PostingIntegrityHarness();
      h.onHand.set("v1", 10);
      h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 5000 });

      // Scan 1 at 10:00: count 4, snapshot 10
      h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 4, capturedAt: 1000 });
      h.snapshots.set("l1", { lineId: "l1", snapshotOnHand: 10, capturedAt: 1000 });

      // 2 units sold: on-hand drops to 8
      h.onHand.set("v1", 8);

      // Scan 2 at 12:00: count 6, snapshot 8
      h.lines.push({ id: "l2", stocktakeId: "st1", variantId: "v1", countedQuantity: 6, capturedAt: 1200 });
      h.snapshots.set("l2", { lineId: "l2", snapshotOnHand: 8, capturedAt: 1200 });

      // Sum resolution: resolved_quantity = 10
      h.resolveVariant("v1", "sum", 10, "st1");

      // Sum uses latest snapshot (8). Delta = 10 - 8 = +2. On-hand becomes 8 + 2 = 10.
      const res = h.postStocktake("st1", "owner-1");
      expect(res.success).toBe(true);
      expect(h.onHand.get("v1")).toBe(10);
      const stocktakeMovs = h.movements.filter((m) => m.reason === "stocktake_correction");
      expect(stocktakeMovs.length).toBe(1);
      expect(stocktakeMovs[0].quantityDelta).toBe(2);
    });

    it("F2: override resolution with missing chosen_line_id raises ST013", () => {
      const h = new PostingIntegrityHarness();
      h.stocktakes.set("st1", { id: "st1", status: "draft", isOpeningCount: false, postingDate: 5000 });
      h.lines.push({ id: "l1", stocktakeId: "st1", variantId: "v1", countedQuantity: 5, capturedAt: 1000 });
      h.lines.push({ id: "l2", stocktakeId: "st1", variantId: "v1", countedQuantity: 6, capturedAt: 1010 });
      h.snapshots.set("l1", { lineId: "l1", snapshotOnHand: 10, capturedAt: 1000 });
      h.snapshots.set("l2", { lineId: "l2", snapshotOnHand: 10, capturedAt: 1010 });

      // Override without chosenLineId
      h.resolveVariant("v1", "override", 5, "st1");

      expect(() => h.postStocktake("st1", "owner-1")).toThrowError(/ST013.*override resolution with no chosen line/);
    });
  });
});
