// Feature: super-admin-platform, Property 19: Time-range/period validation and inclusive windowing
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateTimeRange } from "../src/lib/platform/range";

/**
 * Property 19: Time-range/period validation and inclusive windowing
 *
 * **Validates: Requirements 2.5, 2.6, 2.7, 19.4, 19.5, 19.6, 19.7**
 *
 * The time-range validator must:
 * - Both absent → valid with default 30-day range
 * - One present other missing → invalid
 * - start > end → invalid
 * - >366 days → invalid
 * - Exactly 366 days → valid
 * - Non-parseable dates → invalid
 * - Valid range → valid with inclusive ISO date endpoints (YYYY-MM-DD)
 */

// ─── Constants ──────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ─── Generators ────────────────────────────────────────────────────────────────

/** Generate a valid ISO date string within a reasonable range */
const isoDateArb = fc
  .date({
    min: new Date("2020-01-01"),
    max: new Date("2030-12-31"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

/** Generate a valid date range (from <= to, within 366 days) */
const validRangeArb = isoDateArb.chain((from) => {
  const fromDate = new Date(from);
  const maxTo = new Date(fromDate.getTime() + 366 * MS_PER_DAY);
  const clampedMax = maxTo > new Date("2030-12-31") ? new Date("2030-12-31") : maxTo;
  return fc
    .date({ min: fromDate, max: clampedMax, noInvalidDate: true })
    .map((toDate) => ({
      from,
      to: toDate.toISOString().slice(0, 10),
    }));
});

/** Generate an invalid date string — strings that Date() cannot parse */
const invalidDateArb = fc.oneof(
  fc.constant("not-a-date"),
  fc.constant("2024-13-45"),
  fc.constant("abc"),
  fc.constant("xyz-99-99"),
  fc.constant("hello world"),
  fc.constant("9999-99-99"),
  fc.constant("????"),
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => isNaN(new Date(s).getTime()))
);

/** Generate absent values (null, undefined, empty string) */
const absentValueArb = fc.oneof(
  fc.constant(null as string | null),
  fc.constant(undefined as string | undefined),
  fc.constant("" as string)
);

// ─── Property Tests ─────────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 19: Time-range/period validation and inclusive windowing", () => {
  describe("both absent → valid with default 30-day range", () => {
    it("returns valid=true with from/to spanning 30 days when both are absent", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date("2022-01-01"), max: new Date("2028-12-31"), noInvalidDate: true }),
          (now) => {
            const result = validateTimeRange({ from: undefined, to: undefined }, now);
            expect(result.valid).toBe(true);
            if (result.valid) {
              // Endpoints are ISO date strings
              expect(result.from).toMatch(ISO_DATE_REGEX);
              expect(result.to).toMatch(ISO_DATE_REGEX);

              // Range is 30 days
              const fromDate = new Date(result.from);
              const toDate = new Date(result.to);
              const diffDays = (toDate.getTime() - fromDate.getTime()) / MS_PER_DAY;
              expect(diffDays).toBe(30);

              // `to` is today (given `now`)
              expect(result.to).toBe(now.toISOString().slice(0, 10));
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("null/empty values for both also yield the default 30-day range", () => {
      fc.assert(
        fc.property(absentValueArb, absentValueArb, (from, to) => {
          const result = validateTimeRange({ from, to });
          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.from).toMatch(ISO_DATE_REGEX);
            expect(result.to).toMatch(ISO_DATE_REGEX);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("one present other missing → invalid", () => {
    it("returns invalid when from is present but to is absent", () => {
      fc.assert(
        fc.property(isoDateArb, absentValueArb, (from, to) => {
          const result = validateTimeRange({ from, to });
          expect(result.valid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("returns invalid when to is present but from is absent", () => {
      fc.assert(
        fc.property(absentValueArb, isoDateArb, (from, to) => {
          const result = validateTimeRange({ from, to });
          expect(result.valid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("start > end → invalid", () => {
    it("returns invalid when from date is strictly after to date", () => {
      fc.assert(
        fc.property(
          isoDateArb,
          fc.integer({ min: 1, max: 1000 }),
          (to, daysExtra) => {
            const toDate = new Date(to);
            const fromDate = new Date(toDate.getTime() + daysExtra * MS_PER_DAY);
            const from = fromDate.toISOString().slice(0, 10);

            const result = validateTimeRange({ from, to });
            expect(result.valid).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe(">366 days → invalid", () => {
    it("returns invalid when range exceeds 366 days", () => {
      fc.assert(
        fc.property(
          isoDateArb,
          fc.integer({ min: 367, max: 1000 }),
          (from, rangeDays) => {
            const fromDate = new Date(from);
            const toDate = new Date(fromDate.getTime() + rangeDays * MS_PER_DAY);
            const to = toDate.toISOString().slice(0, 10);

            const result = validateTimeRange({ from, to });
            expect(result.valid).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("exactly 366 days → valid", () => {
    it("returns valid when range is exactly 366 days", () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2028-12-31"), noInvalidDate: true }),
          (fromDateObj) => {
            const from = fromDateObj.toISOString().slice(0, 10);
            const toDateObj = new Date(fromDateObj.getTime() + 366 * MS_PER_DAY);
            const to = toDateObj.toISOString().slice(0, 10);

            const result = validateTimeRange({ from, to });
            expect(result.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("invalid date strings → invalid", () => {
    it("returns invalid for non-parseable date in from", () => {
      fc.assert(
        fc.property(invalidDateArb, isoDateArb, (from, to) => {
          const result = validateTimeRange({ from, to });
          expect(result.valid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("returns invalid for non-parseable date in to", () => {
      fc.assert(
        fc.property(isoDateArb, invalidDateArb, (from, to) => {
          const result = validateTimeRange({ from, to });
          expect(result.valid).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("valid range → valid with inclusive ISO date endpoints", () => {
    it("valid ranges return from/to as YYYY-MM-DD ISO date strings", () => {
      fc.assert(
        fc.property(validRangeArb, ({ from, to }) => {
          const result = validateTimeRange({ from, to });
          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.from).toMatch(ISO_DATE_REGEX);
            expect(result.to).toMatch(ISO_DATE_REGEX);
            // Endpoints are inclusive (from <= to)
            expect(new Date(result.from).getTime()).toBeLessThanOrEqual(
              new Date(result.to).getTime()
            );
          }
        }),
        { numRuns: 100 }
      );
    });

    it("same day is a valid range", () => {
      fc.assert(
        fc.property(isoDateArb, (date) => {
          const result = validateTimeRange({ from: date, to: date });
          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.from).toBe(date);
            expect(result.to).toBe(date);
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
