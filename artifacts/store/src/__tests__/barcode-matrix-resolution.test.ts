import { describe, it, expect } from "vitest";

/**
 * F3 Identification Scenario Matrix Tests (docs/tasks/identification-scenario-matrix.md)
 *
 * Verifies the variant_barcodes data model and scan resolution logic across:
 * - Scenario S1: Manufacturer barcode, unique per variant -> single match
 * - Scenario S2: One manufacturer barcode shared by several variants (e.g. 4 mug colours) -> list of all matches
 * - Scenario S4: One variant carrying several barcodes (supplier packaging change) -> reachable by any code
 */

interface VariantBarcodeRow {
  id: string;
  variantId: string;
  barcode: string;
  source: "manufacturer" | "internal";
  isPrimary: boolean;
}

interface Variant {
  id: string;
  productId: string;
  sku: string;
  price: number;
  color?: string;
}

class BarcodeCatalog {
  private barcodes: VariantBarcodeRow[] = [];
  private variants: Map<string, Variant> = new Map();

  addVariant(variant: Variant) {
    this.variants.set(variant.id, variant);
  }

  addBarcode(variantId: string, barcode: string, source: "manufacturer" | "internal" = "manufacturer", isPrimary: boolean = true) {
    // Enforce UNIQUE (variant_id, barcode)
    const exists = this.barcodes.some((b) => b.variantId === variantId && b.barcode === barcode);
    if (exists) {
      throw new Error(`uq_variant_barcodes_variant_barcode: variant ${variantId} already has barcode ${barcode}`);
    }

    // Enforce partial unique index: at most one primary barcode per variant
    if (isPrimary) {
      const existingPrimary = this.barcodes.find((b) => b.variantId === variantId && b.isPrimary);
      if (existingPrimary) {
        existingPrimary.isPrimary = false; // or throw if enforcing strict index
      }
    }

    const row: VariantBarcodeRow = {
      id: `bc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      variantId,
      barcode,
      source,
      isPrimary,
    };
    this.barcodes.push(row);
    return row;
  }

  scan(scannedBarcode: string) {
    const matchingRows = this.barcodes.filter((b) => b.barcode === scannedBarcode);
    return matchingRows
      .map((row) => {
        const variant = this.variants.get(row.variantId);
        if (!variant) return null;
        return {
          barcode: row.barcode,
          isPrimary: row.isPrimary,
          source: row.source,
          variant,
        };
      })
      .filter(Boolean);
  }
}

describe("F3: Barcode Scenario Matrix Resolution (S1, S2, S4)", () => {
  it("S1: Manufacturer barcode unique per variant resolves to exactly one match", () => {
    const catalog = new BarcodeCatalog();
    catalog.addVariant({ id: "var-unique", productId: "prod-1", sku: "SKU-001", price: 29.99 });
    catalog.addBarcode("var-unique", "4006381333931");

    const matches = catalog.scan("4006381333931");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.variant.id).toBe("var-unique");
    expect(matches[0]?.variant.sku).toBe("SKU-001");
  });

  it("S2: One manufacturer barcode shared by several variants returns all matches for operator disambiguation", () => {
    const catalog = new BarcodeCatalog();
    const sharedEAN = "5901234123457";

    // Same mug in four colours sharing one supplier EAN
    const colours = ["Blue", "Red", "Green", "Yellow"];
    colours.forEach((c) => {
      const varId = `mug-${c.toLowerCase()}`;
      catalog.addVariant({ id: varId, productId: "prod-mug", sku: `MUG-${c.toUpperCase()}`, price: 15.0, color: c });
      // Non-unique barcode column would fail here; variant_barcodes table permits shared barcodes
      catalog.addBarcode(varId, sharedEAN, "manufacturer", true);
    });

    const matches = catalog.scan(sharedEAN);
    expect(matches).toHaveLength(4);

    const resolvedColours = matches.map((m) => m?.variant.color);
    expect(resolvedColours).toEqual(["Blue", "Red", "Green", "Yellow"]);
  });

  it("S4: One variant carrying several barcodes resolves when scanned by either code", () => {
    const catalog = new BarcodeCatalog();
    const variantId = "var-packaging-change";
    catalog.addVariant({ id: variantId, productId: "prod-pkg", sku: "PKG-01", price: 10.0 });

    const oldPackagingCode = "1111222233334";
    const newPackagingCode = "9999888877776";

    // Variant holds both old and new packaging barcodes
    catalog.addBarcode(variantId, oldPackagingCode, "manufacturer", false);
    catalog.addBarcode(variantId, newPackagingCode, "manufacturer", true);

    // Scanning old code resolves to this variant
    const oldScanMatches = catalog.scan(oldPackagingCode);
    expect(oldScanMatches).toHaveLength(1);
    expect(oldScanMatches[0]?.variant.id).toBe(variantId);

    // Scanning new code also resolves to this variant
    const newScanMatches = catalog.scan(newPackagingCode);
    expect(newScanMatches).toHaveLength(1);
    expect(newScanMatches[0]?.variant.id).toBe(variantId);
  });

  it("enforces uniqueness on (variant_id, barcode) while permitting shared barcodes across variants", () => {
    const catalog = new BarcodeCatalog();
    catalog.addVariant({ id: "var-1", productId: "p1", sku: "S1", price: 5 });
    catalog.addVariant({ id: "var-2", productId: "p2", sku: "S2", price: 5 });

    // Permitted: different variants sharing barcode
    catalog.addBarcode("var-1", "SHARED-123");
    expect(() => catalog.addBarcode("var-2", "SHARED-123")).not.toThrow();

    // Rejected: identical barcode for the same variant
    expect(() => catalog.addBarcode("var-1", "SHARED-123")).toThrow(/uq_variant_barcodes_variant_barcode/);
  });
});
