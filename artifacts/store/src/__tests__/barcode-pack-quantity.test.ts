import { describe, it, expect } from "vitest";

/**
 * A3 Barcode Pack Quantity Tests (prompts/m1-schema-additions.md § A3)
 *
 * Verifies that scanning an outer packaging code (e.g. a case of 12)
 * generates a movement representing the full pack quantity (12 units).
 */

interface VariantBarcode {
  id: string;
  variantId: string;
  barcode: string;
  packQuantity: number;
  packUnit: string;
}

interface ProductVariant {
  id: string;
  sku: string;
  onHand: number;
  unitOfMeasure: string;
  trackStock: boolean;
  lowStockThreshold: number | null;
}

interface StockMovement {
  id: string;
  variantId: string;
  quantityDelta: number;
  reason: string;
  postingDate: string;
  transactionId?: string | null;
  correlationId?: string | null;
}

class InventoryScanManager {
  private barcodes = new Map<string, VariantBarcode[]>();
  private variants = new Map<string, ProductVariant>();
  public movements: StockMovement[] = [];

  addVariant(variant: ProductVariant) {
    this.variants.set(variant.id, { ...variant });
  }

  addBarcode(barcode: VariantBarcode) {
    const list = this.barcodes.get(barcode.barcode) || [];
    list.push({ ...barcode });
    this.barcodes.set(barcode.barcode, list);
  }

  scan(barcodeStr: string): { variant: ProductVariant; barcode: VariantBarcode }[] {
    const list = this.barcodes.get(barcodeStr) || [];
    return list
      .map((bc) => {
        const v = this.variants.get(bc.variantId);
        return v ? { variant: { ...v }, barcode: { ...bc } } : null;
      })
      .filter((item): item is { variant: ProductVariant; barcode: VariantBarcode } => item !== null);
  }

  receiveScan(
    barcodeStr: string,
    options: { scanCount?: number; reason?: string; postingDate?: string; transactionId?: string | null; correlationId?: string | null } = {}
  ): StockMovement {
    const matches = this.scan(barcodeStr);
    if (matches.length !== 1) throw new Error(`Expected 1 match, found ${matches.length}`);

    const { variant, barcode } = matches[0]!;
    const scanCount = options.scanCount ?? 1;
    const movementQty = scanCount * barcode.packQuantity;

    const movement: StockMovement = {
      id: `mov-${Date.now()}`,
      variantId: variant.id,
      quantityDelta: movementQty,
      reason: options.reason ?? "goods_receipt",
      postingDate: options.postingDate ?? new Date().toISOString(),
      transactionId: options.transactionId ?? null,
      correlationId: options.correlationId ?? null,
    };

    const liveVariant = this.variants.get(variant.id)!;
    liveVariant.onHand += movementQty;
    this.movements.push(movement);
    return movement;
  }

  adjustStock(params: {
    barcode?: string;
    variantId?: string;
    packCount?: number;
    quantityDelta?: number;
    reason?: string;
    postingDate?: string;
    transactionId?: string | null;
    correlationId?: string | null;
  }): StockMovement {
    let { barcode, variantId, packCount, quantityDelta, reason, postingDate, transactionId, correlationId } = params;

    if (barcode) {
      const cleanBarcode = barcode.trim();
      const bRows = this.barcodes.get(cleanBarcode) || [];
      if (bRows.length > 0) {
        if (!variantId) {
          if (bRows.length > 1) {
            const candidates = bRows.map((r) => r.variantId);
            const err = new Error(
              `Barcode '${cleanBarcode}' matches multiple variants (${candidates.join(", ")}). Please specify variant_id.`
            ) as any;
            err.candidates = candidates;
            throw err;
          }
          variantId = bRows[0]!.variantId;
        }

        const matchedRow = bRows.find((r) => r.variantId === variantId);
        if (!matchedRow) {
          throw new Error(`Barcode '${cleanBarcode}' does not belong to variant '${variantId}'`);
        }

        const packQty = Number(matchedRow.packQuantity ?? 1);
        if (quantityDelta === undefined || quantityDelta === null) {
          const count = typeof packCount === "number" && packCount !== 0 ? packCount : 1;
          quantityDelta = count * packQty;
        }
      }
    }

    if (!variantId || typeof quantityDelta !== "number" || quantityDelta === 0) {
      throw new Error("variant_id (or valid barcode) and non-zero numeric quantity_delta are required");
    }

    const liveVariant = this.variants.get(variantId);
    if (!liveVariant) {
      throw new Error(`Variant '${variantId}' not found`);
    }

    const movement: StockMovement = {
      id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      variantId,
      quantityDelta,
      reason: reason ?? "goods_receipt",
      postingDate: postingDate ?? new Date().toISOString(),
      transactionId: transactionId ?? null,
      correlationId: correlationId ?? null,
    };

    liveVariant.onHand += quantityDelta;
    this.movements.push(movement);
    return movement;
  }
}

describe("A3: Barcode Pack Quantity & Movement Generation", () => {
  it("a scan of a code with pack quantity 12 produces a movement of 12, not 1", () => {
    const manager = new InventoryScanManager();
    const variantId = "var-mug-001";
    manager.addVariant({ id: variantId, sku: "MUG-WHT", onHand: 0, unitOfMeasure: "pcs", trackStock: true, lowStockThreshold: 10 });

    const caseBarcode = "0123456789012";
    manager.addBarcode({ id: "bc-case-12", variantId, barcode: caseBarcode, packQuantity: 12, packUnit: "pcs" });

    // 1 scan of the case barcode at goods receiving
    const movement = manager.receiveScan(caseBarcode, { scanCount: 1, reason: "goods_receipt" });

    // Assert: Movement quantity_delta is 12, NOT 1
    expect(movement.quantityDelta).toBe(12);
    expect(movement.quantityDelta).not.toBe(1);

    // Assert: On-hand quantity is updated to 12
    const scannedMatches = manager.scan(caseBarcode);
    expect(scannedMatches[0]?.variant.onHand).toBe(12);
  });

  it("differentiates piece barcode (pack quantity 1) from case barcode (pack quantity 12) on same variant", () => {
    const manager = new InventoryScanManager();
    const variantId = "var-soda-can";
    manager.addVariant({ id: variantId, sku: "SODA-330ML", onHand: 0, unitOfMeasure: "pcs", trackStock: true, lowStockThreshold: 24 });

    const pieceBarcode = "400000000001";
    manager.addBarcode({ id: "bc-piece", variantId, barcode: pieceBarcode, packQuantity: 1, packUnit: "pcs" });

    const caseBarcode = "400000000024";
    manager.addBarcode({ id: "bc-case-24", variantId, barcode: caseBarcode, packQuantity: 24, packUnit: "pcs" });

    const pieceMov = manager.receiveScan(pieceBarcode, { scanCount: 1 });
    expect(pieceMov.quantityDelta).toBe(1);

    const caseMov = manager.receiveScan(caseBarcode, { scanCount: 1 });
    expect(caseMov.quantityDelta).toBe(24);

    const liveMatches = manager.scan(pieceBarcode);
    expect(liveMatches[0]?.variant.onHand).toBe(25);
  });

  it("supports multiple pack scans (e.g. 3 cases of 12 = 36)", () => {
    const manager = new InventoryScanManager();
    const variantId = "var-soap";
    manager.addVariant({ id: variantId, sku: "SOAP-BAR", onHand: 10, unitOfMeasure: "pcs", trackStock: true, lowStockThreshold: 5 });
    manager.addBarcode({ id: "bc-case-12", variantId, barcode: "987654321012", packQuantity: 12, packUnit: "pcs" });

    const mov = manager.receiveScan("987654321012", { scanCount: 3 });
    expect(mov.quantityDelta).toBe(36);

    const matches = manager.scan("987654321012");
    expect(matches[0]?.variant.onHand).toBe(46);
  });

  it("A1 & A2: records posting_date distinct from created_at and supports correlation_id reversal", () => {
    const manager = new InventoryScanManager();
    const variantId = "var-flour";
    manager.addVariant({ id: variantId, sku: "FLOUR-1KG", onHand: 0, unitOfMeasure: "kg", trackStock: true, lowStockThreshold: 20 });
    manager.addBarcode({ id: "bc-sack-10", variantId, barcode: "555123456789", packQuantity: 10, packUnit: "kg" });

    const historicalPostingDate = "2026-11-01T08:00:00Z";
    const receipt = manager.receiveScan("555123456789", {
      scanCount: 1,
      reason: "goods_receipt",
      postingDate: historicalPostingDate,
      transactionId: "tx-batch-101",
    });

    expect(receipt.quantityDelta).toBe(10);
    expect(receipt.postingDate).toBe(historicalPostingDate);
    expect(receipt.transactionId).toBe("tx-batch-101");

    // Compensating reversal linked by correlation_id
    const reversal = manager.receiveScan("555123456789", {
      scanCount: -1,
      reason: "return_to_supplier",
      postingDate: "2026-11-02T10:00:00Z",
      correlationId: receipt.id,
    });

    expect(reversal.quantityDelta).toBe(-10);
    expect(reversal.correlationId).toBe(receipt.id);
    expect(manager.scan("555123456789")[0]?.variant.onHand).toBe(0);
  });

  it("G2 Path 1: shared barcode with multiple variants rejects naming candidates when variant_id is omitted", () => {
    const manager = new InventoryScanManager();
    const sharedBarcode = "5901234123457";

    // Scenario S2: Same supplier barcode shared by blue and red mugs
    manager.addVariant({ id: "mug-blue", sku: "MUG-BLU", onHand: 10, unitOfMeasure: "pcs", trackStock: true, lowStockThreshold: 5 });
    manager.addVariant({ id: "mug-red", sku: "MUG-RED", onHand: 10, unitOfMeasure: "pcs", trackStock: true, lowStockThreshold: 5 });

    // Blue mug has pack quantity 1 (single unit), Red mug has pack quantity 12 (case)
    manager.addBarcode({ id: "bc-blue", variantId: "mug-blue", barcode: sharedBarcode, packQuantity: 1, packUnit: "pcs" });
    manager.addBarcode({ id: "bc-red", variantId: "mug-red", barcode: sharedBarcode, packQuantity: 12, packUnit: "pcs" });

    // Attempt adjustment with only barcode and no variant_id: must reject and name candidates
    expect(() => {
      manager.adjustStock({ barcode: sharedBarcode, reason: "goods_receipt" });
    }).toThrowError(/matches multiple variants \(mug-blue, mug-red\)/);

    // Verify no movement was recorded and stock remained untouched
    expect(manager.movements).toHaveLength(0);
    expect(manager.scan(sharedBarcode)[0]?.variant.onHand).toBe(10);
    expect(manager.scan(sharedBarcode)[1]?.variant.onHand).toBe(10);
  });

  it("G2 Path 2: shared barcode with variant_id reads pack_quantity from THAT variant's row, not the first candidate", () => {
    const manager = new InventoryScanManager();
    const sharedBarcode = "5901234123457";

    manager.addVariant({ id: "mug-blue", sku: "MUG-BLU", onHand: 0, unitOfMeasure: "pcs", trackStock: true, lowStockThreshold: 5 });
    manager.addVariant({ id: "mug-red", sku: "MUG-RED", onHand: 0, unitOfMeasure: "pcs", trackStock: true, lowStockThreshold: 5 });

    // First candidate in list is blue (pack 1), second candidate is red (pack 12)
    manager.addBarcode({ id: "bc-blue", variantId: "mug-blue", barcode: sharedBarcode, packQuantity: 1, packUnit: "pcs" });
    manager.addBarcode({ id: "bc-red", variantId: "mug-red", barcode: sharedBarcode, packQuantity: 12, packUnit: "pcs" });

    // Operator disambiguated by specifying variant_id = "mug-red" (pack 12)
    const movement = manager.adjustStock({
      barcode: sharedBarcode,
      variantId: "mug-red",
      packCount: 1,
      reason: "goods_receipt",
    });

    // Assert: Movement quantity_delta is 12 (from mug-red's row), NOT 1 (from mug-blue's row [0])
    expect(movement.quantityDelta).toBe(12);
    expect(movement.quantityDelta).not.toBe(1);
    expect(movement.variantId).toBe("mug-red");

    // Stock for mug-red is 12; mug-blue is untouched at 0
    const matches = manager.scan(sharedBarcode);
    const blueMatch = matches.find((m) => m.variant.id === "mug-blue");
    const redMatch = matches.find((m) => m.variant.id === "mug-red");
    expect(redMatch?.variant.onHand).toBe(12);
    expect(blueMatch?.variant.onHand).toBe(0);
  });
});
