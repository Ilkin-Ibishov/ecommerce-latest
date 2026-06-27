import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { validateTimeRange } from "../src/lib/platform/range";

/**
 * Time-Range / Period Validation Property Tests
 * Feature: super-admin-platform, Property 19: Time-range/period validation and inclusive windowing
 *
 * **Validates: Requirements 2.5, 2.6, 2.7, 19.4, 19.5, 19.6, 19.7**
 *
 * For any time range or analytics period, when start is after end or the period is
 * missing an endpoint, contains a non-date, or exceeds 366 days, the request SHALL be
 * rejected with 400 returning no figures; otherwise metrics SHALL be computed over the
 * inclusive endpoints, defaulting to the most recent 30 days when no range is provided.
 */

// ─── Constants (mirror the implementation contract, not its internals) ──────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;

// Constrain generated dates to a sane window so toISOString() never overflows
// (year must stay within 0001–9999) while still covering a wide span.
const DAY_MIN = Math.floor(Date.UTC(1971, 0, 1) / MS_PER_DAY);
const DAY_MAX = Math.floor(Date.UTC(2099, 11, 31) / MS_PER_DAY);

// ─── Helpers / Generators ───────────────────────────────────────────────────────

/** Convert a whole-day index since the epoch into a YYYY-MM-DD string (UTC midnight). */
function isoFromDayIndex(dayIndex: number): string {
  return new Date(dayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

/** A day index (whole days since epoch) within the supported window. */
const dayIndexArb = fc.integer({ min: DAY_MIN, max: DAY_MAX });

/**
 * A pair (from, to) whose inclusive span is between 0 and 366 days — i.e. a VALID range.
 * Returns the ISO date strings plus the original endpoints for round-trip assertions.
 */
const validRangeArb = fc
  .tuple(dayIndexArb, fc.integer({ min: 0, max: MAX_RANGE_DAYS }))
  .filter(([start, span]) => start + span <= DAY_MAX)
  .map(([start, span]) => ({
    from: isoFromDayIndex(start),
    to: isoFromDayIndex(start + span),
    spanDays: span,
  }));

/**
 * A pair where start is strictly AFTER end (from > to).
 */
const startAfterEndArb = fc
  .tuple(dayIndexArb, fc.integer({ min: 1, max: 1000 }))
  .filter(([later, span]) => later - span >= DAY_MIN)
  .map(([later, span]) => ({
    from: isoFromDayIndex(later),
    to: isoFromDayIndex(later - span),
  }));

/**
 * A pair whose span EXCEEDS 366 days.
 */
const tooLongRangeArb = fc
  .tuple(dayIndexArb, fc.integer({ min: MAX_RANGE_DAYS + 1, max: 5000 }))
  .filter(([start, span]) => start + span <= DAY_MAX)
  .map(([start, span]) => ({
    from: isoFromDayIndex(start),
    to: isoFromDayIndex(start + span),
    spanDays: span,
  }));

/** A non-empty string that is NOT parseable as a date. */
const nonDateStringArb = fc
  .oneof(
    fc.constantFrom(
      "not-a-date",
      "hello",
      "garbage",
      "2021-99-99",
      "13/13/2020",
      "xyz",
      "true",
      "Date",
      "tomorrow",
      "----",
    ),
    fc.string({ minLength: 1, maxLength: 12 }),
  )
  .filter((s) => s.trim().length > 0 && Number.isNaN(new Date(s).getTime()));

/** A value treated as "absent": undefined, null, or empty string. */
const absentArb = fc.constantFrom<undefined | null | "">(undefined, null, "");

// Deterministic "now" for default-range assertions.
const FIXED_NOW = new Date("2024-06-15T12:00:00.000Z");

// ─── Property 19 ─────────────────────────────────────────────────────────────────

describe("Feature: super-admin-platform, Property 19: Time-range/period validation and inclusive windowing", () => {
  describe("Valid range → inclusive endpoints preserved (R2.5, R19.4)", () => {
    it("for any range spanning 0..366 days, returns valid with the exact inclusive endpoints", () => {
      fc.assert(
        fc.property(validRangeArb, ({ from, to }) => {
          const result = validateTimeRange({ from, to });

          expect(result.valid).toBe(true);
          if (result.valid) {
            // Inclusive windowing: endpoints are returned unchanged (start and end included).
            expect(result.from).toBe(from);
            expect(result.to).toBe(to);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("accepts a span of exactly 366 days (boundary is inclusive)", () => {
      fc.assert(
        fc.property(
          dayIndexArb.filter((start) => start + MAX_RANGE_DAYS <= DAY_MAX),
          (start) => {
            const from = isoFromDayIndex(start);
            const to = isoFromDayIndex(start + MAX_RANGE_DAYS);
            const result = validateTimeRange({ from, to });
            expect(result.valid).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("accepts a zero-length range (from === to)", () => {
      fc.assert(
        fc.property(dayIndexArb, (day) => {
          const iso = isoFromDayIndex(day);
          const result = validateTimeRange({ from: iso, to: iso });
          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.from).toBe(iso);
            expect(result.to).toBe(iso);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("No range → default last 30 days (R2.6, R19.5)", () => {
    it("for any absent/empty endpoints, defaults to the most recent 30 days (inclusive)", () => {
      const expectedTo = FIXED_NOW.toISOString().slice(0, 10);
      const expectedFrom = new Date(FIXED_NOW.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY)
        .toISOString()
        .slice(0, 10);

      fc.assert(
        fc.property(absentArb, absentArb, (from, to) => {
          const result = validateTimeRange({ from, to }, FIXED_NOW);

          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.to).toBe(expectedTo);
            expect(result.from).toBe(expectedFrom);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Start after end → rejected, no figures (R2.7, R19.6)", () => {
    it("for any range whose start is after its end, returns invalid with an error", () => {
      fc.assert(
        fc.property(startAfterEndArb, ({ from, to }) => {
          const result = validateTimeRange({ from, to });

          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(typeof result.error).toBe("string");
            expect(result.error.length).toBeGreaterThan(0);
            // No figures/endpoints leak on rejection.
            expect(result).not.toHaveProperty("from");
            expect(result).not.toHaveProperty("to");
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Missing one endpoint → rejected (R19.7)", () => {
    it("when exactly one endpoint is present, returns invalid", () => {
      const oneMissingArb = fc.oneof(
        fc.tuple(validRangeArb, absentArb).map(([{ from }, missing]) => ({
          from,
          to: missing,
        })),
        fc.tuple(validRangeArb, absentArb).map(([{ to }, missing]) => ({
          from: missing,
          to,
        })),
      );

      fc.assert(
        fc.property(oneMissingArb, ({ from, to }) => {
          const result = validateTimeRange({ from, to });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Non-date endpoint → rejected, no partial data (R19.7)", () => {
    it("when either present endpoint is not a date, returns invalid", () => {
      // Both endpoints present (so we exercise the date-parsing path, not the
      // missing-endpoint path), with at least one being a non-date string.
      const badPairArb = fc.oneof(
        // invalid from, valid to
        fc.tuple(nonDateStringArb, validRangeArb).map(([bad, { to }]) => ({
          from: bad,
          to,
        })),
        // valid from, invalid to
        fc.tuple(validRangeArb, nonDateStringArb).map(([{ from }, bad]) => ({
          from,
          to: bad,
        })),
        // both invalid
        fc.tuple(nonDateStringArb, nonDateStringArb).map(([a, b]) => ({
          from: a,
          to: b,
        })),
      );

      fc.assert(
        fc.property(badPairArb, ({ from, to }) => {
          const result = validateTimeRange({ from, to });
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.length).toBeGreaterThan(0);
            // No partial figures returned.
            expect(result).not.toHaveProperty("from");
            expect(result).not.toHaveProperty("to");
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Range exceeds 366 days → rejected (R19.4 upper bound)", () => {
    it("for any range longer than 366 days, returns invalid with an error", () => {
      fc.assert(
        fc.property(tooLongRangeArb, ({ from, to }) => {
          const result = validateTimeRange({ from, to });

          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error.length).toBeGreaterThan(0);
            expect(result).not.toHaveProperty("from");
            expect(result).not.toHaveProperty("to");
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Cross-cutting: outcome is always a well-formed discriminated union", () => {
    it("every result is either {valid:true, from, to} or {valid:false, error}", () => {
      const anyInputArb = fc.record({
        from: fc.oneof(validRangeArb.map((r) => r.from), nonDateStringArb, absentArb),
        to: fc.oneof(validRangeArb.map((r) => r.to), nonDateStringArb, absentArb),
      });

      fc.assert(
        fc.property(anyInputArb, (input) => {
          const result = validateTimeRange(input, FIXED_NOW);
          if (result.valid) {
            expect(typeof result.from).toBe("string");
            expect(typeof result.to).toBe("string");
            // Valid endpoints are inclusive and ordered (from <= to as ISO strings).
            expect(result.from <= result.to).toBe(true);
          } else {
            expect(typeof result.error).toBe("string");
            expect(result.error.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
