import { describe, it, expect } from "vitest";

/**
 * M2b Stocktake Reconciliation & Concurrency Suite
 * Tests R1 (typo vs recount), R3 (location defaults & collisions), and R5 (latest snapshot & interleaved flags).
 */

interface Line {
  id: string;
  variantId: string;
  counterId: string;
  countedQuantity: number;
  locationNote?: string | null;
  createdAt: number;
}

interface Snapshot {
  lineId: string;
  snapshotOnHand: number;
  capturedAt: number;
}

interface Movement {
  id: string;
  variantId: string;
  delta: number;
  createdAt: number;
}

interface Resolution {
  variantId: string;
  type: "sum" | "override";
  resolvedQuantity: number;
}

class ReconciliationHarness {
  public onHand = new Map<string, number>();
  public lines: Line[] = [];
  public snapshots = new Map<string, Snapshot>();
  public movements: Movement[] = [];
  public resolutions = new Map<string, Resolution>();

  public insertLine(line: Line): void {
    this.lines.push(line);
    // AFTER INSERT trigger captures snapshot from current on_hand
    const current = this.onHand.get(line.variantId) ?? 0;
    this.snapshots.set(line.id, {
      lineId: line.id,
      snapshotOnHand: current,
      capturedAt: line.createdAt,
    });
  }

  // R1: Typo fix - updates counted_quantity only; snapshot remains unchanged
  public editLineTypo(lineId: string, newCount: number): void {
    const line = this.lines.find((l) => l.id === lineId);
    if (!line) throw new Error("Line not found");
    line.countedQuantity = newCount;
  }

  // R1: Recount - delete existing line and rescan
  public recountLine(oldLineId: string, newLine: Line): void {
    this.lines = this.lines.filter((l) => l.id !== oldLineId);
    this.snapshots.delete(oldLineId);
    this.insertLine(newLine);
  }

  public recordSale(variantId: string, qty: number, timestamp: number): void {
    const cur = this.onHand.get(variantId) ?? 0;
    this.onHand.set(variantId, cur - qty);
    this.movements.push({ id: `mov-${this.movements.length + 1}`, variantId, delta: -qty, createdAt: timestamp });
  }

  // Reconcile variant scans and check flags (R3, R5)
  public reconcileVariant(variantId: string): {
    effectiveCount: number;
    effectiveSnapshot: number;
    delta: number;
    status: "single" | "sum_defaulted" | "resolved" | "unresolved_collision";
    hasInterleavedMovements: boolean;
    interleavedWindow?: { start: number; end: number };
  } {
    const vLines = this.lines.filter((l) => l.variantId === variantId);
    if (!vLines.length) throw new Error("No lines for variant");

    // R5: Latest snapshot
    const sorted = [...vLines].sort((a, b) => b.createdAt - a.createdAt);
    const latestSnapshot = this.snapshots.get(sorted[0].id)!.snapshotOnHand;

    // R5: Check interleaved movements between earliest and latest scan
    const earliestAt = Math.min(...vLines.map((l) => l.createdAt));
    const latestAt = Math.max(...vLines.map((l) => l.createdAt));
    const hasInterleaved = earliestAt < latestAt && this.movements.some(
      (m) => m.variantId === variantId && m.createdAt > earliestAt && m.createdAt < latestAt,
    );

    const res = this.resolutions.get(variantId);
    if (res) {
      return {
        effectiveCount: res.resolvedQuantity,
        effectiveSnapshot: latestSnapshot,
        delta: res.resolvedQuantity - latestSnapshot,
        status: "resolved",
        hasInterleavedMovements: hasInterleaved,
        interleavedWindow: earliestAt < latestAt ? { start: earliestAt, end: latestAt } : undefined,
      };
    }

    if (vLines.length === 1) {
      return {
        effectiveCount: vLines[0].countedQuantity,
        effectiveSnapshot: latestSnapshot,
        delta: vLines[0].countedQuantity - latestSnapshot,
        status: "single",
        hasInterleavedMovements: false,
      };
    }

    // R3: Check distinct location notes
    const validLocations = vLines.map((l) => (l.locationNote ?? "").trim()).filter(Boolean);
    const hasDistinctLocations = validLocations.length === vLines.length && new Set(validLocations).size === vLines.length;

    if (hasDistinctLocations) {
      const sum = vLines.reduce((acc, l) => acc + l.countedQuantity, 0);
      return {
        effectiveCount: sum,
        effectiveSnapshot: latestSnapshot,
        delta: sum - latestSnapshot,
        status: "sum_defaulted",
        hasInterleavedMovements: hasInterleaved,
        interleavedWindow: { start: earliestAt, end: latestAt },
      };
    }

    return {
      effectiveCount: 0,
      effectiveSnapshot: latestSnapshot,
      delta: 0,
      status: "unresolved_collision",
      hasInterleavedMovements: hasInterleaved,
    };
  }
}

describe("M2b Stocktake Reconciliation, Concurrency, and Invariants", () => {
  it("R1: an edited line keeps original snapshot; a deleted-and-rescanned line gets a new snapshot", () => {
    const h = new ReconciliationHarness();
    h.onHand.set("v1", 10);

    // Staff counts 8 at t=1000, enters line (snapshot captured as 10)
    h.insertLine({ id: "l1", variantId: "v1", counterId: "u1", countedQuantity: 8, createdAt: 1000 });
    expect(h.snapshots.get("l1")?.snapshotOnHand).toBe(10);

    // Sale of 2 units occurs at t=1100 (on-hand drops to 8)
    h.recordSale("v1", 2, 1100);
    expect(h.onHand.get("v1")).toBe(8);

    // Case A: Staff fixes typo: 8 -> 7. Snapshot must stay 10.
    h.editLineTypo("l1", 7);
    expect(h.snapshots.get("l1")?.snapshotOnHand).toBe(10);
    const typoReconciled = h.reconcileVariant("v1");
    // Delta against original snapshot: 7 - 10 = -3
    expect(typoReconciled.delta).toBe(-3);

    // Case B: Recount (new observation): line is deleted and rescanned at t=1200
    h.recountLine("l1", { id: "l2", variantId: "v1", counterId: "u1", countedQuantity: 7, createdAt: 1200 });
    // Fresh snapshot captured from current on_hand (8)
    expect(h.snapshots.get("l2")?.snapshotOnHand).toBe(8);
    const recountReconciled = h.reconcileVariant("v1");
    // Delta against new snapshot: 7 - 8 = -1
    expect(recountReconciled.delta).toBe(-1);
  });

  it("R5: multi-counter lines reconcile against latest snapshot and flag interleaved sales", () => {
    const h = new ReconciliationHarness();
    h.onHand.set("v1", 12);

    // Ali counts front shelf at 14:00 (t=1400), finds 5. Snapshot=12
    h.insertLine({ id: "l1", variantId: "v1", counterId: "ali", countedQuantity: 5, locationNote: "Front", createdAt: 1400 });

    // Sale of 1 unit at 14:15 (t=1415), on-hand becomes 11
    h.recordSale("v1", 1, 1415);

    // Samir counts store room at 14:30 (t=1430), finds 10. Snapshot=11
    h.insertLine({ id: "l2", variantId: "v1", counterId: "samir", countedQuantity: 10, locationNote: "Store Room", createdAt: 1430 });

    const reconciled = h.reconcileVariant("v1");
    expect(reconciled.effectiveCount).toBe(15);
    // Must use latest snapshot (11)
    expect(reconciled.effectiveSnapshot).toBe(11);
    // Delta = 15 - 11 = +4
    expect(reconciled.delta).toBe(4);
    // Interleaved sale flag raised with exact window
    expect(reconciled.hasInterleavedMovements).toBe(true);
    expect(reconciled.interleavedWindow).toEqual({ start: 1400, end: 1430 });
  });

  it("R5: single-scan path never produces interleaved sale flag", () => {
    const h = new ReconciliationHarness();
    h.onHand.set("v1", 10);
    h.insertLine({ id: "l1", variantId: "v1", counterId: "ali", countedQuantity: 10, createdAt: 1000 });
    h.recordSale("v1", 1, 1050);

    const reconciled = h.reconcileVariant("v1");
    expect(reconciled.hasInterleavedMovements).toBe(false);
  });

  it("R3: distinct location notes default to sum; duplicate locations require explicit resolution", () => {
    const h = new ReconciliationHarness();
    h.onHand.set("v1", 20);

    // Different locations -> sum_defaulted
    h.insertLine({ id: "l1", variantId: "v1", counterId: "ali", countedQuantity: 8, locationNote: "Shelf A", createdAt: 1000 });
    h.insertLine({ id: "l2", variantId: "v1", counterId: "samir", countedQuantity: 12, locationNote: "Shelf B", createdAt: 1010 });
    const r1 = h.reconcileVariant("v1");
    expect(r1.status).toBe("sum_defaulted");
    expect(r1.effectiveCount).toBe(20);

    // Duplicate locations (both 'Shelf A') -> collision blocks posting
    const h2 = new ReconciliationHarness();
    h2.onHand.set("v2", 10);
    h2.insertLine({ id: "l3", variantId: "v2", counterId: "ali", countedQuantity: 5, locationNote: "Shelf A", createdAt: 1000 });
    h2.insertLine({ id: "l4", variantId: "v2", counterId: "samir", countedQuantity: 6, locationNote: "Shelf A", createdAt: 1010 });
    const r2 = h2.reconcileVariant("v2");
    expect(r2.status).toBe("unresolved_collision");

    // Owner resolves with override -> resolved
    h2.resolutions.set("v2", { variantId: "v2", type: "override", resolvedQuantity: 6 });
    const r3 = h2.reconcileVariant("v2");
    expect(r3.status).toBe("resolved");
    expect(r3.effectiveCount).toBe(6);
  });
});
