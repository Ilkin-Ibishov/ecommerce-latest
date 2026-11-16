import { describe, it, expect } from "vitest";

// Pure business logic functions mirroring database RPC & API rules in M4 design note

export function resolveThreshold(variantThreshold: number | null | undefined, globalThreshold: number | null | undefined): number {
  if (variantThreshold != null && !isNaN(variantThreshold)) return variantThreshold;
  if (globalThreshold != null && !isNaN(globalThreshold)) return globalThreshold;
  return 10;
}

export function classifyStockSignal(available: number, threshold: number): "out" | "low" | "healthy" {
  if (available <= 0) return "out";
  if (available <= threshold) return "low";
  return "healthy";
}

export function computeVelocity(netUnitsSold: number, windowDays: number): number {
  if (windowDays <= 0) return 0;
  return Math.round((netUnitsSold / windowDays) * 10000) / 10000;
}

export function computeReorderSuggestion(params: {
  available: number;
  velocity: number;
  targetDays: number;
  salesCount: number;
  minSales: number;
}): {
  daysOfCover: number | null;
  suggestedQty: number | null;
  hasEnoughData: boolean;
} {
  const { available, velocity, targetDays, salesCount, minSales } = params;
  if (velocity <= 0) {
    return { daysOfCover: null, suggestedQty: null, hasEnoughData: false };
  }

  const daysOfCover = Math.round((Math.max(0, available) / velocity) * 10) / 10;
  const hasEnoughData = salesCount >= minSales;

  if (!hasEnoughData) {
    return { daysOfCover, suggestedQty: null, hasEnoughData: false };
  }

  // suggested_qty = ceil(target_days * velocity - available)
  // When available < 0 (deficit), subtracting negative available correctly adds deficit to order
  const rawQty = targetDays * velocity - available;
  const suggestedQty = Math.max(0, Math.ceil(rawQty));

  return { daysOfCover, suggestedQty, hasEnoughData: true };
}

export function isDeadStock(params: {
  trackStock: boolean;
  onHand: number;
  daysSinceFirstReceived: number;
  windowDays: number;
  netUnitsSoldInWindow: number;
}): boolean {
  const { trackStock, onHand, daysSinceFirstReceived, windowDays, netUnitsSoldInWindow } = params;
  if (!trackStock) return false;
  if (onHand <= 0) return false;
  if (daysSinceFirstReceived < windowDays) return false; // Onboarding floor: newly received items cannot be dead
  return netUnitsSoldInWindow <= 0;
}

export function evaluateDigestSuppression(params: {
  previouslyAlertedVariantIds: Set<string>;
  currentLowVariantIds: string[];
  currentAvailableMap: Map<string, number>;
  thresholdMap: Map<string, number>;
}): {
  newlyLowVariants: string[];
  recoveredVariantIds: string[];
} {
  const { previouslyAlertedVariantIds, currentLowVariantIds, currentAvailableMap, thresholdMap } = params;

  // 1. Recovered: was previously alerted, but now available > threshold
  const recoveredVariantIds: string[] = [];
  for (const id of previouslyAlertedVariantIds) {
    const avail = currentAvailableMap.get(id) ?? 0;
    const thresh = thresholdMap.get(id) ?? 10;
    if (avail > thresh) {
      recoveredVariantIds.push(id);
    }
  }

  // 2. Newly low: currently low and not in suppression set
  const newlyLowVariants = currentLowVariantIds.filter((id) => !previouslyAlertedVariantIds.has(id));

  return { newlyLowVariants, recoveredVariantIds };
}

describe("M4 Stock Signals Domain Logic", () => {
  describe("Threshold Resolution", () => {
    it("uses variant threshold when specified", () => {
      expect(resolveThreshold(5, 10)).toBe(5);
      expect(resolveThreshold(0, 10)).toBe(0);
    });

    it("falls back to global threshold when variant threshold is null/undefined", () => {
      expect(resolveThreshold(null, 15)).toBe(15);
      expect(resolveThreshold(undefined, 20)).toBe(20);
    });

    it("falls back to default 10 when both are null/undefined", () => {
      expect(resolveThreshold(null, null)).toBe(10);
      expect(resolveThreshold(undefined, undefined)).toBe(10);
    });
  });

  describe("Signal Classification", () => {
    it("classifies out of stock when available <= 0", () => {
      expect(classifyStockSignal(0, 10)).toBe("out");
      expect(classifyStockSignal(-2, 10)).toBe("out");
    });

    it("classifies low stock when 0 < available <= threshold", () => {
      expect(classifyStockSignal(5, 10)).toBe("low");
      expect(classifyStockSignal(10, 10)).toBe("low");
    });

    it("classifies healthy stock when available > threshold", () => {
      expect(classifyStockSignal(11, 10)).toBe("healthy");
      expect(classifyStockSignal(50, 10)).toBe("healthy");
    });
  });

  describe("Reorder Suggestions & Honesty Requirements", () => {
    it("suggests quantity covering target days horizon with ceil", () => {
      // 14 sales in 28 days -> velocity = 0.5 units/day
      // available = 5, target = 60 days
      // raw = 60 * 0.5 - 5 = 25
      const res = computeReorderSuggestion({
        available: 5,
        velocity: 0.5,
        targetDays: 60,
        salesCount: 5,
        minSales: 3,
      });
      expect(res.hasEnoughData).toBe(true);
      expect(res.daysOfCover).toBe(10); // 5 / 0.5 = 10 days
      expect(res.suggestedQty).toBe(25);
    });

    it("adds deficit to suggested quantity when available is negative", () => {
      // velocity = 1 unit/day, target = 60, available = -4 (deficit)
      // raw = 60 * 1 - (-4) = 64
      const res = computeReorderSuggestion({
        available: -4,
        velocity: 1,
        targetDays: 60,
        salesCount: 10,
        minSales: 3,
      });
      expect(res.hasEnoughData).toBe(true);
      expect(res.daysOfCover).toBe(0);
      expect(res.suggestedQty).toBe(64);
    });

    it("returns null suggestedQty and hasEnoughData=false when sales_count < minSales", () => {
      // Only 2 sales (below minSales 3)
      const res = computeReorderSuggestion({
        available: 2,
        velocity: 0.2,
        targetDays: 60,
        salesCount: 2,
        minSales: 3,
      });
      expect(res.hasEnoughData).toBe(false);
      expect(res.suggestedQty).toBeNull();
      expect(res.daysOfCover).toBe(10); // Still reports days of cover
    });
  });

  describe("Dead Stock Qualification", () => {
    it("qualifies when on-hand > 0, received >= 90 days ago, and net sales <= 0", () => {
      expect(isDeadStock({
        trackStock: true,
        onHand: 15,
        daysSinceFirstReceived: 120,
        windowDays: 90,
        netUnitsSoldInWindow: 0,
      })).toBe(true);
    });

    it("disqualifies newly received items under the onboarding floor (< 90 days)", () => {
      expect(isDeadStock({
        trackStock: true,
        onHand: 20,
        daysSinceFirstReceived: 14, // Received 2 weeks ago
        windowDays: 90,
        netUnitsSoldInWindow: 0,
      })).toBe(false);
    });

    it("remains dead stock when an accidental sale was voided (net sales = 0)", () => {
      // Sale of -1 followed by void of +1 leaves netUnitsSold = 0
      expect(isDeadStock({
        trackStock: true,
        onHand: 5,
        daysSinceFirstReceived: 100,
        windowDays: 90,
        netUnitsSoldInWindow: 0,
      })).toBe(true);
    });

    it("disqualifies non-tracked variants", () => {
      expect(isDeadStock({
        trackStock: false,
        onHand: 10,
        daysSinceFirstReceived: 120,
        windowDays: 90,
        netUnitsSoldInWindow: 0,
      })).toBe(false);
    });
  });

  describe("Digest Alert Suppression & Recovery", () => {
    it("identifies newly low variants and suppresses re-notifying until recovery", () => {
      const previouslyAlerted = new Set(["v1"]); // v1 was already alerted
      const currentLow = ["v1", "v2"]; // v1 is still low, v2 newly dropped low
      const currentAvail = new Map([["v1", 2], ["v2", 3], ["v3", 25]]);
      const thresholds = new Map([["v1", 5], ["v2", 5], ["v3", 5]]);

      const res = evaluateDigestSuppression({
        previouslyAlertedVariantIds: previouslyAlerted,
        currentLowVariantIds: currentLow,
        currentAvailableMap: currentAvail,
        thresholdMap: thresholds,
      });

      // v2 is newly low (must be notified)
      expect(res.newlyLowVariants).toEqual(["v2"]);
      // v1 is still low, so not recovered
      expect(res.recoveredVariantIds).toEqual([]);
    });

    it("clears suppression when variant recovers above threshold", () => {
      const previouslyAlerted = new Set(["v1"]);
      const currentLow: string[] = []; // v1 restocked to 20 (> 5)
      const currentAvail = new Map([["v1", 20]]);
      const thresholds = new Map([["v1", 5]]);

      const res = evaluateDigestSuppression({
        previouslyAlertedVariantIds: previouslyAlerted,
        currentLowVariantIds: currentLow,
        currentAvailableMap: currentAvail,
        thresholdMap: thresholds,
      });

      expect(res.recoveredVariantIds).toEqual(["v1"]);
      expect(res.newlyLowVariants).toEqual([]);
    });
  });
});
