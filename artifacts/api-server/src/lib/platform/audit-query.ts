/**
 * Platform audit-log query shaper (R11.3, R11.4, R11.5).
 *
 * A PURE function (no DB) that shapes a list of audit entries according to
 * the Control_Plane audit read requirements:
 *   - Order by `created_at` descending (newest first)
 *   - Cap at 100 entries per request
 *   - Optional `store_id` filter: if provided and valid UUID → filter; if
 *     provided and INVALID → return error indicator; if absent → no filter
 *   - Empty result set (after filter) → empty array
 */

/** Minimal audit entry shape expected by the shaper. */
export interface AuditEntry {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  changes: unknown;
  scope: string;
  store_id: string | null;
  created_at: string;
}

export interface AuditQueryParams {
  /** Optional store_id filter. If provided, must be a valid UUID. */
  store_id?: string;
}

export type AuditQueryResult =
  | { data: AuditEntry[]; error?: never }
  | { data?: never; error: "invalid_store_filter" };

/** Maximum entries returned per request (R11.3). */
const MAX_ENTRIES = 100;

/**
 * UUID v4 format regex — used to validate the optional store_id filter.
 * Accepts standard 8-4-4-4-12 hex format (case-insensitive).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shapes and filters a raw list of audit entries.
 *
 * @param entries - The unsorted/unfiltered array of audit entries from the DB.
 * @param params  - Query parameters (currently only `store_id`).
 * @returns Either `{ data: AuditEntry[] }` or `{ error: 'invalid_store_filter' }`.
 */
export function shapeAuditQuery(
  entries: AuditEntry[],
  params: AuditQueryParams
): AuditQueryResult {
  // R11.5: If a store_id filter is provided but invalid, return error.
  if (params.store_id != null && params.store_id !== "") {
    if (!UUID_RE.test(params.store_id)) {
      return { error: "invalid_store_filter" };
    }
  }

  let result = entries;

  // R11.4: Filter by store_id when provided and valid.
  if (params.store_id != null && params.store_id !== "") {
    const filterId = params.store_id.toLowerCase();
    result = result.filter(
      (e) => e.store_id != null && e.store_id.toLowerCase() === filterId
    );
  }

  // R11.3: Order by created_at descending (newest first).
  result = [...result].sort((a, b) => {
    if (b.created_at > a.created_at) return 1;
    if (b.created_at < a.created_at) return -1;
    return 0;
  });

  // R11.3: Cap at 100 entries.
  result = result.slice(0, MAX_ENTRIES);

  return { data: result };
}
