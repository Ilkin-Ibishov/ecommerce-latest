import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Feature: super-admin-platform, Property 23: Invoice generation is exactly-once-per-interval

import { computeNextInvoice, type InvoiceGenerationInput } from "../src/lib/billing/generate";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate an ISO date string (YYYY-MM-DD) between 2020 and 2025 */
const isoDateArb = fc
  .date({ min: new Date("2020-01-01"), max: new Date("2025-12-31"), noInvalidDate: true })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString().slice(0, 10));

const trialDaysArb = fc.integer({ min: 1, max: 90 });

const billingIntervalArb = fc.constantFrom("monthly" as const, "yearly" as const);

const dueDaysArb = fc.integer({ min: 1, max: 90 });

const planPriceArb = fc.double({ min: 0.01, max: 99999.99, noNaN: true }).map((v) => Math.round(v * 100) / 100);

// ─── Property 23: Invoice generation is exactly-once-per-interval ───────────────

describe("Feature: super-admin-platform, Property 23: Invoice generation is exactly-once-per-interval", () => {
  describe("trial end gate", () => {
    it("if now < storeCreatedAt + trialDays, no invoice is generated", () => {
      fc.assert(
        fc.property(isoDateArb, trialDaysArb, billingIntervalArb, planPriceArb, (createdAt, trialDays, interval, price) => {
          // now is before trial end
          const now = addDays(createdAt, trialDays - 1);
          const input: InvoiceGenerationInput = {
            storeCreatedAt: createdAt,
            trialDays,
            billingAnchor: null,
            billingInterval: interval,
            dueDays: 14,
            planPrice: price,
            existingInvoicePeriods: [],
            now,
          };
          const result = computeNextInvoice(input);
          expect(result.generate).toBe(false);
          if (!result.generate) {
            expect(result.reason).toBe("trial_not_ended");
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("billing anchor and no drift", () => {
    it("first invoice period_start equals the billing anchor (trial end)", () => {
      fc.assert(
        fc.property(isoDateArb, trialDaysArb, billingIntervalArb, planPriceArb, dueDaysArb, (createdAt, trialDays, interval, price, dueDays) => {
          const trialEnd = addDays(createdAt, trialDays);
          // now is on or after trial end
          const now = trialEnd;
          const input: InvoiceGenerationInput = {
            storeCreatedAt: createdAt,
            trialDays,
            billingAnchor: null,
            billingInterval: interval,
            dueDays,
            planPrice: price,
            existingInvoicePeriods: [],
            now,
          };
          const result = computeNextInvoice(input);
          expect(result.generate).toBe(true);
          if (result.generate) {
            expect(result.invoice.period_start).toBe(trialEnd);
            expect(result.invoice.billing_anchor).toBe(trialEnd);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("amount equals plan price", () => {
    it("generated invoice amount always equals the plan price", () => {
      fc.assert(
        fc.property(isoDateArb, trialDaysArb, billingIntervalArb, planPriceArb, dueDaysArb, (createdAt, trialDays, interval, price, dueDays) => {
          const trialEnd = addDays(createdAt, trialDays);
          const input: InvoiceGenerationInput = {
            storeCreatedAt: createdAt,
            trialDays,
            billingAnchor: null,
            billingInterval: interval,
            dueDays,
            planPrice: price,
            existingInvoicePeriods: [],
            now: trialEnd,
          };
          const result = computeNextInvoice(input);
          if (result.generate) {
            expect(result.invoice.amount).toBe(price);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("exactly-once per period (unique per period)", () => {
    it("if the period already exists in existingInvoicePeriods, no duplicate is generated", () => {
      fc.assert(
        fc.property(isoDateArb, trialDaysArb, billingIntervalArb, planPriceArb, (createdAt, trialDays, interval, price) => {
          const trialEnd = addDays(createdAt, trialDays);
          // First: generate the invoice to get period boundaries
          const input1: InvoiceGenerationInput = {
            storeCreatedAt: createdAt,
            trialDays,
            billingAnchor: null,
            billingInterval: interval,
            dueDays: 14,
            planPrice: price,
            existingInvoicePeriods: [],
            now: trialEnd,
          };
          const result1 = computeNextInvoice(input1);
          if (!result1.generate) return; // skip if not applicable

          // Second: add the period to existing and try again
          const input2: InvoiceGenerationInput = {
            ...input1,
            existingInvoicePeriods: [
              { period_start: result1.invoice.period_start, period_end: result1.invoice.period_end },
            ],
          };
          const result2 = computeNextInvoice(input2);
          // Should either generate a DIFFERENT period or not generate at all
          if (result2.generate) {
            expect(result2.invoice.period_start).not.toBe(result1.invoice.period_start);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("due_date correctness", () => {
    it("due_date = issue_date + dueDays", () => {
      fc.assert(
        fc.property(isoDateArb, trialDaysArb, billingIntervalArb, planPriceArb, dueDaysArb, (createdAt, trialDays, interval, price, dueDays) => {
          const trialEnd = addDays(createdAt, trialDays);
          const input: InvoiceGenerationInput = {
            storeCreatedAt: createdAt,
            trialDays,
            billingAnchor: null,
            billingInterval: interval,
            dueDays,
            planPrice: price,
            existingInvoicePeriods: [],
            now: trialEnd,
          };
          const result = computeNextInvoice(input);
          if (result.generate) {
            const expectedDueDate = addDays(result.invoice.issue_date, dueDays);
            expect(result.invoice.due_date).toBe(expectedDueDate);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
