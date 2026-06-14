import type { Request } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@workspace/supabase-types";

/**
 * Input payload for a single audit-log entry.
 *
 * Design §9 (R10). This is the single API that replaces the three inline
 * audit-write styles currently scattered across the route files.
 */
export interface AuditInput {
  /** Service-role Supabase client used to perform the insert. */
  admin: SupabaseClient<Database>;
  /** The originating request — used only to log write failures via `req.log`. */
  req: Request;
  /** Acting admin's user id. */
  actorId: string;
  /** Action verb, e.g. "create_product", "update_order_status". */
  action: string;
  /** Logical entity type, e.g. "product", "order", "user". */
  entityType: string;
  /** Affected entity id, or null for bulk/global actions. */
  entityId?: string | null;
  /** Arbitrary change details persisted as JSONB. */
  details?: Record<string, unknown> | null;
}

/**
 * Fire-and-forget audit-log writer (R10.1, R10.3).
 *
 * Inserts a row into the `audit_log` table and returns immediately — the
 * insert is NOT awaited in the caller's critical path, so a slow or failing
 * audit write can never block or fail the originating request. Failures are
 * logged via `req.log.error` and otherwise swallowed.
 *
 * Column mapping (AuditInput -> audit_log columns), matching the current
 * inline writes which insert `{ actor_id, action, entity, entity_id, changes }`:
 *   - actorId    -> actor_id
 *   - action     -> action
 *   - entityType -> entity
 *   - entityId   -> entity_id   (defaults to null)
 *   - details    -> changes     (JSONB; defaults to {})
 *
 * The recorded entry is content-equivalent to today's inline writes (R10.2).
 */
export function writeAudit(input: AuditInput): void {
  // `Promise.resolve` adapts the PostgREST thenable into a real Promise so we
  // can attach `.catch` for the rejection path. The insert is intentionally
  // not awaited here — control returns to the caller immediately.
  Promise.resolve(
    input.admin
      .from("audit_log")
      .insert({
        actor_id: input.actorId,
        action: input.action,
        entity: input.entityType,
        entity_id: input.entityId ?? null,
        // The inline writes passed `req.body` / plain objects directly into the
        // `changes` JSONB column; `Record<string, unknown>` is content-equivalent
        // and cast to the generated `Json` shape here.
        changes: (input.details ?? {}) as Json,
      })
  )
    .then(({ error }) => {
      if (error) {
        input.req.log.error({ err: error }, "audit write failed");
      }
    })
    .catch((err: unknown) => {
      input.req.log.error({ err }, "audit write failed");
    });
}
