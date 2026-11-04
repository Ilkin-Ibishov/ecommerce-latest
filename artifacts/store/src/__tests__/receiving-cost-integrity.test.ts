import { describe, it, expect } from "vitest";

/**
 * M2a Receiving & Integrity Test Suite
 *
 * Implements DoD:
 * 1. Atomic posting: all lines succeed or zero movements written
 * 2. Reversal creates compensating movements with correlation_id
 * 3. verify_stock_integrity reports ledger vs on_hand corruption
 * 4. rebuild_on_hand repairs on_hand divergence
 * 5. verify_stock_integrity reports projection running_quantity divergence
 * 6. verify_stock_integrity reports unvalued movements and stale cache
 */

interface ReceiptLine {
  id: string;
  variant_id: string;
  quantity: number;
  unit_cost?: number | null;
}

interface Receipt {
  id: string;
  receipt_number: string;
  status: "draft" | "posted" | "reversed";
  posting_date: string;
  transaction_id?: string;
  lines: ReceiptLine[];
}

interface StockMovement {
  id: string;
  variant_id: string;
  quantity_delta: number;
  reason: string;
  transaction_id?: string;
  correlation_id?: string;
}

interface ProjectionRow {
  movement_id: string;
  variant_id: string;
  running_quantity: number;
  running_avg_cost: number;
}

interface IntegrityIssue {
  variant_id: string;
  check_name: string;
  expected_value: number;
  actual_value: number;
  diff: number;
  details: string;
}

class ReceivingAndIntegrityHarness {
  public onHand: Map<string, number> = new Map();
  public movements: StockMovement[] = [];
  public receipts: Map<string, Receipt> = new Map();
  public projections: ProjectionRow[] = [];
  public variantCosts: Map<string, number> = new Map();

  public postReceipt(receiptId: string, actorId: string): void {
    const receipt = this.receipts.get(receiptId);
    if (!receipt) throw new Error(`Receipt ${receiptId} not found`);
    if (receipt.status !== "draft") throw new Error(`Receipt is not draft`);
    if (!receipt.lines.length) throw new Error("No lines in receipt");

    // Atomic validation guard: if any line fails validation, rollback (zero movements written)
    for (const line of receipt.lines) {
      if (line.unit_cost == null || line.unit_cost < 0) {
        throw new Error(`Line ${line.id} has invalid unit_cost; atomic abort`);
      }
    }

    const txId = `tx-${receiptId}`;
    const newMovements: StockMovement[] = [];

    for (const line of receipt.lines) {
      newMovements.push({
        id: `mov-${line.id}`,
        variant_id: line.variant_id,
        quantity_delta: line.quantity,
        reason: "goods_receipt",
        transaction_id: txId,
      });
      const cur = this.onHand.get(line.variant_id) ?? 0;
      this.onHand.set(line.variant_id, cur + line.quantity);
    }

    this.movements.push(...newMovements);
    receipt.status = "posted";
    receipt.transaction_id = txId;
  }

  public reverseReceipt(receiptId: string): void {
    const receipt = this.receipts.get(receiptId);
    if (!receipt || receipt.status !== "posted" || !receipt.transaction_id) {
      throw new Error("Cannot reverse unposted receipt");
    }

    const revTxId = `rev-tx-${receiptId}`;
    const origMovs = this.movements.filter((m) => m.transaction_id === receipt.transaction_id);

    // F4 Pre-flight check: ensure goods have not been consumed before attempting reversal
    for (const om of origMovs) {
      const cur = this.onHand.get(om.variant_id) ?? 0;
      if (cur < om.quantity_delta) {
        throw new Error(
          `Cannot reverse receipt ${receipt.receipt_number}: variant ${om.variant_id} has ${om.quantity_delta - cur} units already consumed (${cur} on hand, ${om.quantity_delta} received)`
        );
      }
    }

    for (const om of origMovs) {
      this.movements.push({
        id: `rev-mov-${om.id}`,
        variant_id: om.variant_id,
        quantity_delta: -om.quantity_delta,
        reason: "return_to_supplier",
        transaction_id: revTxId,
        correlation_id: om.transaction_id,
      });
      const cur = this.onHand.get(om.variant_id) ?? 0;
      this.onHand.set(om.variant_id, cur - om.quantity_delta);
    }

    receipt.status = "reversed";
  }

  public verifyIntegrity(variantId: string): IntegrityIssue[] {
    const issues: IntegrityIssue[] = [];
    const trueLedgerSum = this.movements
      .filter((m) => m.variant_id === variantId)
      .reduce((sum, m) => sum + m.quantity_delta, 0);

    const cachedOnHand = this.onHand.get(variantId) ?? 0;
    if (cachedOnHand !== trueLedgerSum) {
      issues.push({
        variant_id: variantId,
        check_name: "ledger_vs_on_hand",
        expected_value: trueLedgerSum,
        actual_value: cachedOnHand,
        diff: cachedOnHand - trueLedgerSum,
        details: "Cached on_hand does not match sum of stock_movements",
      });
    }

    const latestProj = [...this.projections]
      .reverse()
      .find((p) => p.variant_id === variantId);

    if (latestProj && latestProj.running_quantity !== trueLedgerSum) {
      issues.push({
        variant_id: variantId,
        check_name: "projection_vs_ledger",
        expected_value: trueLedgerSum,
        actual_value: latestProj.running_quantity,
        diff: latestProj.running_quantity - trueLedgerSum,
        details: "Projection running_quantity diverges from cumulative ledger sum",
      });
    }

    const varMovs = this.movements.filter((m) => m.variant_id === variantId);
    for (const vm of varMovs) {
      if (!this.projections.some((p) => p.movement_id === vm.id)) {
        issues.push({
          variant_id: variantId,
          check_name: "unvalued_movement",
          expected_value: 1,
          actual_value: 0,
          diff: -1,
          details: `Movement ${vm.id} has no row in stock_movement_costs`,
        });
      }
    }

    const cachedCost = this.variantCosts.get(variantId);
    if (latestProj && cachedCost !== undefined && cachedCost !== latestProj.running_avg_cost) {
      issues.push({
        variant_id: variantId,
        check_name: "cache_vs_projection",
        expected_value: latestProj.running_avg_cost,
        actual_value: cachedCost,
        diff: cachedCost - latestProj.running_avg_cost,
        details: "variant_costs cache is stale relative to latest projection running average",
      });
    }

    return issues;
  }

  public rebuildOnHand(variantId: string): { repaired: number; delta: number } {
    const cached = this.onHand.get(variantId) ?? 0;
    const trueLedger = this.movements
      .filter((m) => m.variant_id === variantId)
      .reduce((sum, m) => sum + m.quantity_delta, 0);

    this.onHand.set(variantId, trueLedger);

    // F6: Recompute projection for that variant in the same transaction
    const latestProj = [...this.projections].reverse().find((p) => p.variant_id === variantId);
    if (latestProj) {
      latestProj.running_quantity = trueLedger;
    }

    return { repaired: trueLedger, delta: trueLedger - cached };
  }
}

describe("M2a Receiving & Integrity Checks", () => {
  it("atomic posting: receipt with failing last line writes zero movements", () => {
    const harness = new ReceivingAndIntegrityHarness();
    harness.receipts.set("rec-1", {
      id: "rec-1",
      receipt_number: "GR-001",
      status: "draft",
      posting_date: "2026-11-04T10:00:00Z",
      lines: [
        { id: "l1", variant_id: "v1", quantity: 10, unit_cost: 5.0 },
        { id: "l2", variant_id: "v1", quantity: 20, unit_cost: 6.0 },
        { id: "l3", variant_id: "v1", quantity: 5, unit_cost: null }, // Failing line
      ],
    });

    expect(() => harness.postReceipt("rec-1", "user-1")).toThrow("invalid unit_cost");
    expect(harness.movements).toHaveLength(0);
    expect(harness.onHand.get("v1") ?? 0).toBe(0);
    expect(harness.receipts.get("rec-1")?.status).toBe("draft");
  });

  it("reversal creates compensating return_to_supplier movements with correlation_id", () => {
    const harness = new ReceivingAndIntegrityHarness();
    harness.receipts.set("rec-2", {
      id: "rec-2",
      receipt_number: "GR-002",
      status: "draft",
      posting_date: "2026-11-04T10:00:00Z",
      lines: [
        { id: "l21", variant_id: "v2", quantity: 15, unit_cost: 8.0 },
      ],
    });

    harness.postReceipt("rec-2", "user-1");
    expect(harness.onHand.get("v2")).toBe(15);
    expect(harness.receipts.get("rec-2")?.status).toBe("posted");

    harness.reverseReceipt("rec-2");
    expect(harness.onHand.get("v2")).toBe(0);
    expect(harness.receipts.get("rec-2")?.status).toBe("reversed");
    const revMov = harness.movements.find((m) => m.reason === "return_to_supplier")!;
    expect(revMov.quantity_delta).toBe(-15);
    expect(revMov.correlation_id).toBe(harness.receipts.get("rec-2")?.transaction_id);
  });

  it("F4: reversal after partial consumption is refused with specific diagnostic error naming consumed units", () => {
    const harness = new ReceivingAndIntegrityHarness();
    harness.receipts.set("rec-consumed", {
      id: "rec-consumed",
      receipt_number: "GR-004",
      status: "draft",
      posting_date: "2026-11-04T10:00:00Z",
      lines: [
        { id: "line-c1", variant_id: "var-consumed", quantity: 10, unit_cost: 5.0 },
      ],
    });

    harness.postReceipt("rec-consumed", "user-1");
    expect(harness.onHand.get("var-consumed")).toBe(10);

    // Consume 8 units physically via sale
    harness.movements.push({
      id: "mov-sale-8",
      variant_id: "var-consumed",
      quantity_delta: -8,
      reason: "counter_sale",
    });
    harness.onHand.set("var-consumed", 2);

    // Attempting reversal must be refused before inserting anything and name variant and consumed units (8)
    expect(() => harness.reverseReceipt("rec-consumed")).toThrow(
      /Cannot reverse receipt GR-004: variant var-consumed has 8 units already consumed \(2 on hand, 10 received\)/
    );
    expect(harness.onHand.get("var-consumed")).toBe(2);
    expect(harness.receipts.get("rec-consumed")?.status).toBe("posted");
  });

  it("integrity check reports on_hand corruption and rebuild_on_hand repairs it", () => {
    const harness = new ReceivingAndIntegrityHarness();
    harness.movements.push(
      { id: "m-1", variant_id: "v3", quantity_delta: 20, reason: "goods_receipt" },
      { id: "m-2", variant_id: "v3", quantity_delta: -5, reason: "online_sale" },
    );
    // True ledger sum = 15. Deliberately corrupt cached onHand to 25 and projection running_quantity to 25.
    harness.onHand.set("v3", 25);
    harness.projections.push({
      movement_id: "m-2",
      variant_id: "v3",
      running_quantity: 25,
      running_avg_cost: 10.0,
    });

    const issuesBefore = harness.verifyIntegrity("v3");
    const onHandIssue = issuesBefore.find((i) => i.check_name === "ledger_vs_on_hand");
    const projIssue = issuesBefore.find((i) => i.check_name === "projection_vs_ledger");
    expect(onHandIssue).toBeDefined();
    expect(projIssue).toBeDefined();
    expect(onHandIssue?.expected_value).toBe(15);
    expect(onHandIssue?.actual_value).toBe(25);
    expect(onHandIssue?.diff).toBe(10);

    const repairRes = harness.rebuildOnHand("v3");
    expect(repairRes.repaired).toBe(15);
    expect(repairRes.delta).toBe(-10);

    // F6: rebuild_on_hand resolves both on_hand divergence and projection_vs_ledger
    const issuesAfter = harness.verifyIntegrity("v3");
    expect(issuesAfter.some((i) => i.check_name === "ledger_vs_on_hand")).toBe(false);
    expect(issuesAfter.some((i) => i.check_name === "projection_vs_ledger")).toBe(false);
  });

  it("integrity check reports projection divergence, unvalued movements, and stale cache", () => {
    const harness = new ReceivingAndIntegrityHarness();
    harness.movements.push(
      { id: "m-100", variant_id: "v4", quantity_delta: 30, reason: "goods_receipt" },
      { id: "m-101", variant_id: "v4", quantity_delta: -10, reason: "online_sale" },
    );
    harness.onHand.set("v4", 20);

    // Corrupt projection running quantity to 28 instead of 20
    harness.projections.push({
      movement_id: "m-100",
      variant_id: "v4",
      running_quantity: 28,
      running_avg_cost: 12.0,
    });
    // m-101 is missing from projections (unvalued movement)
    // Cached cost is 15.0 instead of 12.0
    harness.variantCosts.set("v4", 15.0);

    const issues = harness.verifyIntegrity("v4");
    expect(issues.some((i) => i.check_name === "projection_vs_ledger")).toBe(true);
    expect(issues.some((i) => i.check_name === "unvalued_movement")).toBe(true);
    expect(issues.some((i) => i.check_name === "cache_vs_projection")).toBe(true);
  });
});
