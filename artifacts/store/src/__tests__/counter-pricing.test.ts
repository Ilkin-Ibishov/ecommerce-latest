import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { allocate, priceCounterSale, type BundleDefinition, type PricingLine } from "@workspace/counter-pricing";

const line = (line_no: number, variant_id: string, quantity: number, price: number, bundle_id?: string): PricingLine =>
  ({ line_no, variant_id, quantity, charged_unit_price: price, bundle_id });
const q = (azn: number) => Math.round(azn * 100);

const box: BundleDefinition = {
  id: "box", bundle_price: 25, lines: [{ variant_id: "A", quantity: 1 }, { variant_id: "B", quantity: 1 }],
};

describe("counter pricing", () => {
  it("no discount: total is the sum of lines", () => {
    const r = priceCounterSale([line(1, "A", 2, 10), line(2, "B", 1, 5.5)], [], 0);
    expect(r.total_amount).toBe(25.5);
    expect(r.lines.map((l) => l.net_line_total)).toEqual([20, 5.5]);
  });

  it("one complete box gets the bundle price", () => {
    const r = priceCounterSale([line(1, "A", 1, 20, "box"), line(2, "B", 1, 10, "box")], [box], 0);
    expect(r.bundle_discount).toBe(5);
    expect(r.total_amount).toBe(25);
  });

  it("two boxes get the discount twice", () => {
    const r = priceCounterSale([line(1, "A", 2, 20, "box"), line(2, "B", 2, 10, "box")], [box], 0);
    expect(r.bundle_discount).toBe(10);
    expect(r.total_amount).toBe(50);
  });

  it("an incomplete box gets no discount", () => {
    const r = priceCounterSale([line(1, "A", 1, 20, "box")], [box], 0);
    expect(r.bundle_discount).toBe(0);
    expect(r.total_amount).toBe(20);
  });

  it("a bundle with no price is a shortcut only", () => {
    const r = priceCounterSale([line(1, "A", 1, 20, "box"), line(2, "B", 1, 10, "box")], [{ ...box, bundle_price: null }], 0);
    expect(r.total_amount).toBe(30);
  });

  it("owner discount after a bundle never makes a line negative", () => {
    const deep: BundleDefinition = { ...box, bundle_price: 1 };
    const r = priceCounterSale([line(1, "A", 1, 10, "box"), line(2, "B", 1, 0.5, "box"), line(3, "C", 1, 10)], [deep], 100);
    expect(r.lines.every((l) => l.net_line_total >= 0)).toBe(true);
    expect(r.total_amount).toBe(0);
  });

  it("free lines and a zero total do not divide by zero", () => {
    const r = priceCounterSale([line(1, "A", 1, 0), line(2, "B", 2, 0)], [], 5);
    expect(r.total_amount).toBe(0);
    expect(r.owner_discount).toBe(0);
  });

  it("rejects a tagged line whose variant is not in the bundle", () => {
    expect(() => priceCounterSale([line(1, "Z", 1, 5, "box")], [box], 0)).toThrow(/not in bundle/);
  });

  it("allocate hands out every qəpik and never exceeds a base", () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 20 }),
      fc.integer({ min: 0, max: 2_000_000 }),
      (bases, amount) => {
        const sum = bases.reduce((a, b) => a + b, 0);
        const d = Math.min(amount, sum);
        const shares = allocate(d, bases);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(sum > 0 ? d : 0);
        shares.forEach((s, i) => expect(s).toBeLessThanOrEqual(bases[i]));
      },
    ));
  });

  it("any cart: lines sum exactly to the total and none is negative", () => {
    fc.assert(fc.property(
      fc.array(fc.record({ qty: fc.integer({ min: 1, max: 5 }), price: fc.integer({ min: 0, max: 50_000 }) }), { minLength: 1, maxLength: 15 }),
      fc.integer({ min: 0, max: 100_000 }),
      (cart, ownerQ) => {
        const lines = cart.map((c, i) => line(i + 1, `V${i}`, c.qty, c.price / 100));
        const r = priceCounterSale(lines, [], ownerQ / 100);
        const sumQ = r.lines.reduce((s, l) => s + q(l.net_line_total), 0);
        expect(sumQ).toBe(q(r.total_amount));
        r.lines.forEach((l) => expect(l.net_line_total).toBeGreaterThanOrEqual(0));
      },
    ));
  });
});
