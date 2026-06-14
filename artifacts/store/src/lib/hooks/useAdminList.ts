import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";

/**
 * Options for {@link useAdminList}.
 *
 * @see Architecture-refactoring design §6 (Frontend admin-list hook + table components, R6).
 */
export interface UseAdminListOptions<Row> {
  /**
   * Data fetcher. Receives the resolved pagination window, the committed
   * (debounced) search term, and an AbortSignal that is triggered when the
   * request is superseded so out-of-order results can be discarded.
   */
  fetcher: (args: {
    offset: number;
    limit: number;
    search: string;
    signal: AbortSignal;
  }) => Promise<{ rows: Row[]; count: number }>;
  /** Page size. Defaults to 30 (matches the existing admin pages). */
  pageSize?: number;
  /** Base path used for URL-state sync, e.g. "/admin/orders". */
  basePath: string;
  /**
   * Debounce delay (ms) applied to searchInput → search. Defaults to 350,
   * matching the existing admin pages (behavior preservation, R6.1).
   */
  debounceMs?: number;
}

/**
 * Result of {@link useAdminList}.
 */
export interface UseAdminListResult<Row> {
  rows: Row[];
  count: number;
  loading: boolean;
  error: Error | null;
  page: number;
  pageSize: number;
  /** Committed (debounced) search value. */
  search: string;
  /** Immediate input value (feeds the SearchInput). */
  searchInput: string;
  setSearchInput: (v: string) => void;
  setPage: (p: number) => void;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_DEBOUNCE_MS = 350;

/**
 * Parse the admin-list URL state from a query string (the value returned by
 * wouter's `useSearch`, without the leading "?").
 *
 * Mirrors the inline parsing used by the existing admin pages: `page` defaults
 * to 1 and is clamped to a minimum of 1; `q` defaults to "".
 */
export function parseAdminListParams(search: string): { page: number; q: string } {
  const params = new URLSearchParams(search);
  const parsed = parseInt(params.get("page") ?? "1", 10);
  const page = Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
  const q = params.get("q") ?? "";
  return { page, q };
}

/**
 * Build an admin-list href, preserving any other query params already present
 * in `currentSearch` (e.g. an OrdersPage `status` filter). Reproduces the
 * existing `buildHref` URL-state behavior:
 * - `page` is omitted when it is 1 (only set when > 1)
 * - `q` is omitted when empty
 */
export function buildAdminListHref(
  basePath: string,
  currentSearch: string,
  next: { page?: number; q?: string },
): string {
  const params = new URLSearchParams(currentSearch);

  if (next.q !== undefined) {
    if (next.q) params.set("q", next.q);
    else params.delete("q");
  }

  if (next.page !== undefined) {
    if (next.page > 1) params.set("page", String(next.page));
    else params.delete("page");
  }

  const qs = params.toString();
  return `${basePath}${qs ? `?${qs}` : ""}`;
}

/**
 * URL-driven admin list controller: reads `page`/`q` from the URL, debounces
 * the search input, resets to page 1 on a new search, syncs page/search to the
 * query params (preserving other params), and runs abortable fetches so
 * out-of-order responses are discarded. On fetch failure it clears `loading`,
 * preserves the prior `rows`, and sets `error` (R6.7).
 */
export function useAdminList<Row>(opts: UseAdminListOptions<Row>): UseAdminListResult<Row> {
  const { basePath } = opts;
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const rawSearch = useSearch();
  const [, navigate] = useLocation();

  const { page, q: urlQ } = parseAdminListParams(rawSearch);
  const offset = (page - 1) * pageSize;

  // Immediate input value and the committed (debounced) search value.
  const [searchInput, setSearchInput] = useState(urlQ);
  const [search, setSearch] = useState(urlQ);

  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Latest-value refs so effects/callbacks can read current values without
  // adding churny dependencies (and without retriggering on identity changes).
  const fetcherRef = useRef(opts.fetcher);
  fetcherRef.current = opts.fetcher;
  const rawSearchRef = useRef(rawSearch);
  rawSearchRef.current = rawSearch;
  const searchRef = useRef(search);
  searchRef.current = search;

  // Debounce searchInput → committed search. On a real change, commit the value
  // and reset to page 1 while preserving other query params (R6.1).
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== searchRef.current) {
        setSearch(searchInput);
        navigate(buildAdminListHref(basePath, rawSearchRef.current, { q: searchInput, page: 1 }), {
          replace: true,
        });
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [searchInput, debounceMs, basePath, navigate]);

  // Abortable fetch keyed on the resolved window + committed search.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetcherRef
      .current({ offset, limit: pageSize, search, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setRows(result.rows);
        setCount(result.count);
        setLoading(false);
      })
      .catch((err: unknown) => {
        // Ignore superseded (aborted) requests — they must not surface as errors.
        if (controller.signal.aborted) return;
        // Preserve prior rows; clear loading; set error (R6.7).
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    return () => controller.abort();
  }, [offset, pageSize, search]);

  const setPage = useCallback(
    (p: number) => {
      navigate(buildAdminListHref(basePath, rawSearchRef.current, { page: p }));
    },
    [basePath, navigate],
  );

  const totalPages = Math.ceil(count / pageSize);

  return {
    rows,
    count,
    loading,
    error,
    page,
    pageSize,
    search,
    searchInput,
    setSearchInput,
    setPage,
    totalPages,
  };
}
