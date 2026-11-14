import { describe, it, expect } from "vitest";

export interface BundleComponentInput {
  variant_id: string;
  track_stock: boolean;
  available: number | null;
  quantity: number;
}

/** Pure helper computing bundle availability per Spec §9 & Audit D4 */
export function computeBundleAvailability(components: BundleComponentInput[]): number | null {
  if (components.length === 0) return null;
  const tracked = components.filter((c) => c.track_stock);
  if (tracked.length === 0) {
    return null; // All non-tracked components -> infinite / null bundle availability
  }
  let minAvail: number | null = null;
  for (const c of tracked) {
    const qty = c.quantity || 1;
    const compAvail = c.available ?? 0;
    const canMake = Math.floor(compAvail / qty);
    minAvail = minAvail === null ? canMake : Math.min(minAvail, canMake);
  }
  return minAvail;
}

/** Pure helper for storefront / counter orderability check */
export function canFulfillLine(trackStock: boolean, available: number | null, requestedQuantity: number): boolean {
  if (!trackStock || available === null) {
    return true; // Non-tracked variants have unlimited availability
  }
  return available >= requestedQuantity;
}

/** Pure helper for rendering availability in badge / stock indicator */
export function formatAvailabilityPill(available: number | null): { isUnlimited: boolean; display: string } {
  if (available === null) {
    return { isUnlimited: true, display: "—" };
  }
  return { isUnlimited: false, display: String(available) };
}

describe("M4 NULL Availability Pure Functions", () => {
  describe("computeBundleAvailability", () => {
    it("reports NULL availability when ALL components are non-tracked", () => {
      const components: BundleComponentInput[] = [
        { variant_id: "s1", track_stock: false, available: null, quantity: 1 },
        { variant_id: "s2", track_stock: false, available: null, quantity: 2 },
      ];
      expect(computeBundleAvailability(components)).toBeNull();
    });

    it("reports the minimum over TRACKED components for a mix of tracked and non-tracked", () => {
      const components: BundleComponentInput[] = [
        { variant_id: "phys1", track_stock: true, available: 10, quantity: 2 },
        { variant_id: "phys2", track_stock: true, available: 12, quantity: 4 },
        { variant_id: "serv1", track_stock: false, available: null, quantity: 1 },
      ];
      expect(computeBundleAvailability(components)).toBe(3);
    });

    it("reports the minimum as normal when all components are tracked", () => {
      const components: BundleComponentInput[] = [
        { variant_id: "p1", track_stock: true, available: 8, quantity: 2 },
        { variant_id: "p2", track_stock: true, available: 5, quantity: 1 },
      ];
      expect(computeBundleAvailability(components)).toBe(4);
    });

    it("handles zero stock on a tracked component in a mixed bundle", () => {
      const components: BundleComponentInput[] = [
        { variant_id: "p1", track_stock: true, available: 0, quantity: 1 },
        { variant_id: "s1", track_stock: false, available: null, quantity: 1 },
      ];
      expect(computeBundleAvailability(components)).toBe(0);
    });
  });

  describe("canFulfillLine", () => {
    it("permits ordering non-tracked variant regardless of requested quantity", () => {
      expect(canFulfillLine(false, null, 1)).toBe(true);
      expect(canFulfillLine(false, null, 9999)).toBe(true);
    });

    it("permits ordering tracked variant when available >= requested", () => {
      expect(canFulfillLine(true, 5, 5)).toBe(true);
      expect(canFulfillLine(true, 5, 3)).toBe(true);
    });

    it("refuses ordering tracked variant when available < requested", () => {
      expect(canFulfillLine(true, 5, 6)).toBe(false);
      expect(canFulfillLine(true, 0, 1)).toBe(false);
    });
  });

  describe("formatAvailabilityPill", () => {
    it("returns unlimited format for null available", () => {
      expect(formatAvailabilityPill(null)).toEqual({ isUnlimited: true, display: "—" });
    });

    it("returns formatted count for tracked available", () => {
      expect(formatAvailabilityPill(0)).toEqual({ isUnlimited: false, display: "0" });
      expect(formatAvailabilityPill(42)).toEqual({ isUnlimited: false, display: "42" });
    });
  });
});
