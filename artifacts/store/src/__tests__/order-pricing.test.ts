import { describe, it, expect } from "vitest";
import { quoteDelivery, goodsTotal, orderTotal, type DeliverySettings } from "@workspace/order-pricing";

describe("order-pricing: quoteDelivery", () => {
  it("null: returns null when delivery_fee_azn is null", () => {
    const s: DeliverySettings = {
      delivery_fee_azn: null,
      free_delivery_threshold_azn: null,
    };
    expect(quoteDelivery(50, s)).toBeNull();
    expect(quoteDelivery(150, { ...s, free_delivery_threshold_azn: 100 })).toBeNull();
  });

  it("flat: fee is charged with no threshold", () => {
    const s: DeliverySettings = {
      delivery_fee_azn: 5,
      free_delivery_threshold_azn: null,
    };
    expect(quoteDelivery(50, s)).toEqual({ fee: 5, remaining: null });
    expect(quoteDelivery(150, s)).toEqual({ fee: 5, remaining: null });
  });

  it("threshold below/at/above: charges fee below threshold and 0 at/above threshold", () => {
    const s: DeliverySettings = {
      delivery_fee_azn: 7.5,
      free_delivery_threshold_azn: 100,
    };
    // below
    expect(quoteDelivery(60, s)).toEqual({ fee: 7.5, remaining: 40 });
    // at
    expect(quoteDelivery(100, s)).toEqual({ fee: 0, remaining: null });
    // above
    expect(quoteDelivery(120, s)).toEqual({ fee: 0, remaining: null });
  });

  it("threshold boundary: 99.99 pays fee, 100.00 is free", () => {
    const s: DeliverySettings = {
      delivery_fee_azn: 5,
      free_delivery_threshold_azn: 100,
    };
    expect(quoteDelivery(99.99, s)).toEqual({ fee: 5, remaining: 0.01 });
    expect(quoteDelivery(100.00, s)).toEqual({ fee: 0, remaining: null });
  });

  it("zero fee setting: always returns fee 0 and remaining null", () => {
    const s: DeliverySettings = {
      delivery_fee_azn: 0,
      free_delivery_threshold_azn: 100,
    };
    expect(quoteDelivery(50, s)).toEqual({ fee: 0, remaining: null });
    expect(quoteDelivery(150, s)).toEqual({ fee: 0, remaining: null });
  });

  it("empty or zero subtotal: fee is 0", () => {
    const s: DeliverySettings = {
      delivery_fee_azn: 5,
      free_delivery_threshold_azn: 100,
    };
    expect(quoteDelivery(0, s)).toEqual({ fee: 0, remaining: 100 });
  });
});

describe("order-pricing: goodsTotal and orderTotal", () => {
  it("goodsTotal calculates subtotal - discount in whole qəpik", () => {
    expect(goodsTotal(100, 20)).toBe(80);
    expect(goodsTotal(19.99, 5.50)).toBe(14.49);
    expect(goodsTotal(10, 15)).toBe(0);
  });

  it("orderTotal calculates subtotal - discount + fee in whole qəpik", () => {
    expect(orderTotal(100, 20, 5)).toBe(85);
    expect(orderTotal(19.99, 5.50, 4.50)).toBe(18.99);
    expect(orderTotal(10, 15, 5)).toBe(5);
  });
});
