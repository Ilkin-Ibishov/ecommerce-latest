/**
 * useAdminList — URL-state property tests (architecture-refactoring R6).
 *
 * Covers the pure URL-state helpers exported by `lib/hooks/useAdminList`:
 *   - parseAdminListParams(search)
 *   - buildAdminListHref(basePath, currentSearch, { page?, q? })
 *
 * Property 7 (Admin-list URL state round-trips): for any page >= 1 and any
 * search string, building the list URL from that state and parsing the
 * resulting query params yields the same page and search; committing a new
 * search resets to page 1.
 *
 * NOTE on the R6.8 transition tests (loading on→off, empty-state render,
 * failure preserves prior rows): those exercise the `useAdminList` hook itself
 * and require React Testing Library `renderHook` running under a DOM
 * environment (jsdom/happy-dom). The store-unit vitest project runs in the
 * `node` environment and the workspace does not include `@testing-library/react`
 * or a DOM env, so the hook-rendering transition assertions cannot run here.
 * They are intentionally omitted; the pure URL-state property below (which
 * needs no DOM) is implemented in full. To enable the transition tests, add a
 * jsdom-backed test project and `@testing-library/react`, then assert against
 * `useAdminList` with a mocked fetcher and a wouter `Router` wrapper.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { parseAdminListParams, buildAdminListHref } from "@/lib/hooks/useAdminList";

const BASE_PATH = "/admin/orders";

/** Extract the query-string portion (without the leading "?") of a built href. */
function queryOf(href: string): string {
  const i = href.indexOf("?");
  return i === -1 ? "" : href.slice(i + 1);
}

describe("useAdminList URL-state helpers", () => {
  // Feature: architecture-refactoring, Property 7: Admin-list URL state round-trips
  describe("Property 7: Admin-list URL state round-trips", () => {
    // Validates: Requirements 6.1, 6.5
    it("build → parse yields the same page and search for any page >= 1 and any search string", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.string(), (page, q) => {
          const href = buildAdminListHref(BASE_PATH, "", { page, q });
          const parsed = parseAdminListParams(queryOf(href));
          expect(parsed.page).toBe(page);
          expect(parsed.q).toBe(q);
        }),
        { numRuns: 200 },
      );
    });

    it("committing a new search resets to page 1 (and keeps the new query)", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1_000_000 }),
          fc.string(),
          fc.string(),
          (existingPage, oldQ, newQ) => {
            // Start from an existing URL state (arbitrary page + old query).
            const existingSearch = queryOf(buildAdminListHref(BASE_PATH, "", { page: existingPage, q: oldQ }));
            // Commit a new search the way the hook does: { q: newQ, page: 1 }.
            const href = buildAdminListHref(BASE_PATH, existingSearch, { q: newQ, page: 1 });
            const parsed = parseAdminListParams(queryOf(href));
            expect(parsed.page).toBe(1);
            expect(parsed.q).toBe(newQ);
          },
        ),
        { numRuns: 200 },
      );
    });

    it("preserves unrelated query params (e.g. an OrdersPage status filter) across builds", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1_000_000 }),
          fc.string(),
          fc.constantFrom("pending", "paid", "shipped", "cancelled"),
          (page, q, status) => {
            const withStatus = `status=${status}`;
            const href = buildAdminListHref(BASE_PATH, withStatus, { page, q });
            const params = new URLSearchParams(queryOf(href));
            expect(params.get("status")).toBe(status);
            const parsed = parseAdminListParams(queryOf(href));
            expect(parsed.page).toBe(page);
            expect(parsed.q).toBe(q);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("parseAdminListParams defaults & clamping (R6.1)", () => {
    it("defaults page to 1 and q to empty when absent", () => {
      const parsed = parseAdminListParams("");
      expect(parsed.page).toBe(1);
      expect(parsed.q).toBe("");
    });

    it("clamps non-positive / NaN page values to 1", () => {
      fc.assert(
        fc.property(fc.integer({ min: -1000, max: 0 }), (n) => {
          expect(parseAdminListParams(`page=${n}`).page).toBe(1);
        }),
        { numRuns: 100 },
      );
      expect(parseAdminListParams("page=abc").page).toBe(1);
    });
  });

  describe("buildAdminListHref omission rules (R6.5)", () => {
    it("omits page when it is 1 and omits q when empty", () => {
      expect(buildAdminListHref(BASE_PATH, "", { page: 1, q: "" })).toBe(BASE_PATH);
    });

    it("sets page only when > 1", () => {
      expect(queryOf(buildAdminListHref(BASE_PATH, "", { page: 1 }))).toBe("");
      expect(new URLSearchParams(queryOf(buildAdminListHref(BASE_PATH, "", { page: 3 }))).get("page")).toBe("3");
    });
  });
});
