// Unit tests for lib/billing/generate.ts — invoice generation logic
// Feature: super-admin-platform
// Requirements: 14.1, 14.11

import { describe, it, expect } from "vitest";
import {
  computeNextInvoice,
  type InvoiceGenerationInput,
} from "../src/lib/billing/generate";

describe("computeNextInvoice", () => {
  const baseInput: InvoiceGenerationInput = {
    storeCreatedAt: "2024-01-01",
    trialDays: 14,
    billingAnchor: null,
    billingInterval: "monthly",
    dueDays: 14,
    planPrice: 99.0,
    existingInvoicePeriods: [],
    now: "2024-02-01",
  };

  describe("trial period", () => {
    it("returns trial_not_ended when now is before trial end", () => {
      const result = computeNextInvoice({
        ...baseInput,
        now: "2024-01-10", // trial ends 2024-01-15
      });
      expect(result).toEqual({ generate: false, reason: "trial_not_ended" });
    });

    it("returns trial_not_ended on the day before trial ends", () => {
      const result = computeNextInvoice({
        ...baseInput,
        now: "2024-01-14", // trial ends 2024-01-15
      });
      expect(result).toEqual({ generate: false, reason: "trial_not_ended" });
    });

    it("generates first invoice on trial end date", () => {
      const result = computeNextInvoice({
        ...baseInput,
        now: "2024-01-15", // trial ends 2024-01-15
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        expect(result.invoice.billing_anchor).toBe("2024-01-15");
        expect(result.invoice.period_start).toBe("2024-01-15");
      }
    });
  });

  describe("first invoice generation", () => {
    it("generates first invoice with correct fields when trial ends", () => {
      const result = computeNextInvoice({
        ...baseInput,
        now: "2024-01-20",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        // Trial end = 2024-01-01 + 14 = 2024-01-15 (anchor)
        expect(result.invoice.billing_anchor).toBe("2024-01-15");
        expect(result.invoice.period_start).toBe("2024-01-15");
        expect(result.invoice.period_end).toBe("2024-02-15");
        expect(result.invoice.issue_date).toBe("2024-01-15");
        expect(result.invoice.due_date).toBe("2024-01-29"); // 2024-01-15 + 14
        expect(result.invoice.amount).toBe(99.0);
      }
    });

    it("uses provided billingAnchor over computed trial end", () => {
      const result = computeNextInvoice({
        ...baseInput,
        billingAnchor: "2024-01-10",
        now: "2024-01-20",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        expect(result.invoice.billing_anchor).toBe("2024-01-10");
        expect(result.invoice.period_start).toBe("2024-01-10");
        expect(result.invoice.period_end).toBe("2024-02-10");
      }
    });
  });

  describe("subsequent invoices (no drift)", () => {
    it("generates second period when first exists", () => {
      const result = computeNextInvoice({
        ...baseInput,
        billingAnchor: "2024-01-15",
        existingInvoicePeriods: [
          { period_start: "2024-01-15", period_end: "2024-02-15" },
        ],
        now: "2024-02-20",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        expect(result.invoice.period_start).toBe("2024-02-15");
        expect(result.invoice.period_end).toBe("2024-03-15");
        expect(result.invoice.issue_date).toBe("2024-02-15");
        expect(result.invoice.due_date).toBe("2024-02-29"); // 2024-02-15 + 14 days
      }
    });

    it("generates third period when first two exist", () => {
      const result = computeNextInvoice({
        ...baseInput,
        billingAnchor: "2024-01-15",
        existingInvoicePeriods: [
          { period_start: "2024-01-15", period_end: "2024-02-15" },
          { period_start: "2024-02-15", period_end: "2024-03-15" },
        ],
        now: "2024-03-20",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        expect(result.invoice.period_start).toBe("2024-03-15");
        expect(result.invoice.period_end).toBe("2024-04-15");
      }
    });

    it("periods do not drift — always computed from anchor", () => {
      // Anchor on Jan 31 with monthly interval
      const result = computeNextInvoice({
        ...baseInput,
        storeCreatedAt: "2024-01-17",
        billingAnchor: "2024-01-31",
        existingInvoicePeriods: [
          { period_start: "2024-01-31", period_end: "2024-02-29" }, // Feb clamps to 29
        ],
        now: "2024-03-05",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        // Period 2 should be anchor + 2*months = 2024-03-31, not 2024-02-29 + 1 month
        expect(result.invoice.period_start).toBe("2024-02-29");
        expect(result.invoice.period_end).toBe("2024-03-31");
      }
    });
  });

  describe("yearly billing interval", () => {
    it("generates yearly periods from anchor", () => {
      const result = computeNextInvoice({
        ...baseInput,
        billingAnchor: "2024-01-15",
        billingInterval: "yearly",
        now: "2024-06-01",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        expect(result.invoice.period_start).toBe("2024-01-15");
        expect(result.invoice.period_end).toBe("2025-01-15");
      }
    });

    it("generates second yearly period when first exists", () => {
      const result = computeNextInvoice({
        ...baseInput,
        billingAnchor: "2024-01-15",
        billingInterval: "yearly",
        existingInvoicePeriods: [
          { period_start: "2024-01-15", period_end: "2025-01-15" },
        ],
        now: "2025-02-01",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        expect(result.invoice.period_start).toBe("2025-01-15");
        expect(result.invoice.period_end).toBe("2026-01-15");
      }
    });
  });

  describe("exactly one invoice per interval", () => {
    it("returns no_pending_period when all eligible periods already generated", () => {
      const result = computeNextInvoice({
        ...baseInput,
        billingAnchor: "2024-01-15",
        existingInvoicePeriods: [
          { period_start: "2024-01-15", period_end: "2024-02-15" },
        ],
        now: "2024-02-10", // before period 2 starts
      });
      expect(result).toEqual({ generate: false, reason: "no_pending_period" });
    });

    it("skips existing periods and finds the gap", () => {
      // Periods 0 and 2 exist, period 1 is missing
      const result = computeNextInvoice({
        ...baseInput,
        billingAnchor: "2024-01-15",
        existingInvoicePeriods: [
          { period_start: "2024-01-15", period_end: "2024-02-15" },
          { period_start: "2024-03-15", period_end: "2024-04-15" },
        ],
        now: "2024-04-01",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        // Should find period 1 (the gap)
        expect(result.invoice.period_start).toBe("2024-02-15");
        expect(result.invoice.period_end).toBe("2024-03-15");
      }
    });
  });

  describe("due_days configuration", () => {
    it("uses custom dueDays for due_date calculation", () => {
      const result = computeNextInvoice({
        ...baseInput,
        dueDays: 30,
        now: "2024-01-20",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        // issue_date = 2024-01-15, due = 2024-01-15 + 30 = 2024-02-14
        expect(result.invoice.due_date).toBe("2024-02-14");
      }
    });

    it("uses minimum dueDays of 1", () => {
      const result = computeNextInvoice({
        ...baseInput,
        dueDays: 1,
        now: "2024-01-20",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        expect(result.invoice.due_date).toBe("2024-01-16");
      }
    });
  });

  describe("trial days configuration", () => {
    it("uses custom trialDays", () => {
      const result = computeNextInvoice({
        ...baseInput,
        trialDays: 30,
        now: "2024-02-05",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        // Trial end = 2024-01-01 + 30 = 2024-01-31
        expect(result.invoice.billing_anchor).toBe("2024-01-31");
        expect(result.invoice.period_start).toBe("2024-01-31");
      }
    });

    it("handles zero trial days", () => {
      const result = computeNextInvoice({
        ...baseInput,
        trialDays: 0,
        now: "2024-01-05",
      });
      expect(result.generate).toBe(true);
      if (result.generate) {
        // Trial end = 2024-01-01 + 0 = 2024-01-01
        expect(result.invoice.billing_anchor).toBe("2024-01-01");
        expect(result.invoice.period_start).toBe("2024-01-01");
      }
    });
  });
});
