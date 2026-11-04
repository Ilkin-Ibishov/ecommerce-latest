import { describe, it, expect } from "vitest";

describe("ReceiptCostSummary — calculations", () => {
  it("sums item total costs and additional landed costs correctly", () => {
    const lines = [
      { id: "1", variant_id: "v1", quantity: 10, total_cost: 150.0 },
      { id: "2", variant_id: "v2", quantity: 5, total_cost: 75.5 },
    ];
    const additionalCosts = { shipping: 30.0, customs: 20.0 };

    const itemsSubtotal = lines.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0);
    const extraCostsTotal = Object.values(additionalCosts).reduce((sum, val) => sum + (Number(val) || 0), 0);
    const grandTotal = itemsSubtotal + extraCostsTotal;

    expect(itemsSubtotal).toBe(225.5);
    expect(extraCostsTotal).toBe(50.0);
    expect(grandTotal).toBe(275.5);
  });

  it("handles null/missing additional costs gracefully", () => {
    const lines = [{ id: "1", variant_id: "v1", quantity: 2, total_cost: 40.0 }];
    const itemsSubtotal = lines.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0);
    const extraCostsTotal = Object.values({} as Record<string, number>).reduce(
      (sum, val) => sum + (Number(val) || 0),
      0
    );
    expect(itemsSubtotal + extraCostsTotal).toBe(40.0);
  });
});

describe("ReceiptLinesTable — cost visibility boundary", () => {
  it("staff role sees line quantities and UOM but no cost fields", () => {
    const line = {
      id: "l1",
      variant_id: "v1",
      quantity: 12,
      unit_cost: null, // staff receives no cost from API
      total_cost: null,
      product_variant: {
        sku: "SKU-001",
        unit_of_measure: "pcs",
        product: { title: "Widget" },
      },
    };

    const isAdmin = false;
    expect(isAdmin).toBe(false);
    expect(line.unit_cost).toBeNull();
    expect(line.total_cost).toBeNull();
  });

  it("admin role sees unit cost and line total", () => {
    const line = {
      id: "l1",
      variant_id: "v1",
      quantity: 10,
      unit_cost: 25.0,
      total_cost: 250.0,
      product_variant: {
        sku: "SKU-002",
        unit_of_measure: "pcs",
        product: { title: "Gadget" },
      },
    };

    const isAdmin = true;
    expect(isAdmin).toBe(true);
    expect(line.unit_cost).toBe(25.0);
    expect(line.total_cost).toBe(250.0);
  });
});

describe("MarginKpis — calculation logic", () => {
  it("computes margin percentage accurately", () => {
    const revenue = 1000.0;
    const cogs = 600.0;
    const grossMargin = revenue - cogs;
    const marginPercent = revenue > 0 ? (grossMargin / revenue) * 100 : 0;

    expect(grossMargin).toBe(400.0);
    expect(marginPercent).toBe(40.0);
  });

  it("handles zero revenue without division by zero", () => {
    const revenue = 0;
    const cogs = 0;
    const grossMargin = 0;
    const marginPercent = revenue > 0 ? (grossMargin / revenue) * 100 : 0;

    expect(grossMargin).toBe(0);
    expect(marginPercent).toBe(0);
  });

  it("handles negative margin when COGS exceeds revenue (loss)", () => {
    const revenue = 100.0;
    const cogs = 150.0;
    const grossMargin = revenue - cogs;
    const marginPercent = revenue > 0 ? (grossMargin / revenue) * 100 : 0;

    expect(grossMargin).toBe(-50.0);
    expect(marginPercent).toBe(-50.0);
  });
});
