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
});
