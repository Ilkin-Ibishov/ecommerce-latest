/**
 * Control_Plane audit writer (R11.1, R11.2, R11.6).
 *
 * A thin wrapper around the fire-and-forget pattern used by the existing
 * `writeAudit()` in `lib/audit.ts`, but targeting the **Control_Plane**
 * database (`getControlPlaneSupabase()`) and always injecting
 * `scope: 'platform'` + an optional `store_id`.
 *
 * This is the ONLY mechanism platform routes should use to write audit entries.
 * Direct inline `audit_log` inserts are forbidden.
 *
 * On failure the error is logged via the provided logger but NEVER thrown or
 * surfaced to the caller — the originating operation always completes (R11.6).
 */
import { getControlPlaneSupabase } from "../control-plane-supabase";
import { logger } from "../logger";
import type { ControlPlanJson } from "@workspace/supabase-types";

export interface ControlPlaneAuditInput {
  /** Acting Super_Admin's user id. Omit for system-actor (scheduler) entries. */
  actorId?: string;
  /** Action verb, e.g. "suspend_store", "create_plan". */
  action: string;
  /** Logical entity type, e.g. "store", "plan", "notification". */
  entity: string;
  /** Affected entity id, or undefined for bulk/global actions. */
  entityId?: string;
  /** Arbitrary change details (before/after state). */
  changes?: Record<string, unknown>;
  /** Associated Store id (when the action targets a specific Store). */
  storeId?: string;
}

/**
 * Fire-and-forget audit-log writer for the Control_Plane.
 *
 * Inserts a row into the Control_Plane `audit_log` with `scope = 'platform'`.
 * The insert is intentionally NOT awaited — control returns to the caller
 * immediately. Failures are logged and swallowed (R11.6).
 */
export function writePlatformAudit(input: ControlPlaneAuditInput): void {
  const supabase = getControlPlaneSupabase();

  Promise.resolve(
    supabase.from("audit_log").insert({
      actor_id: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      changes: (input.changes ?? {}) as ControlPlanJson,
      scope: "platform" as const,
      store_id: input.storeId ?? null,
    })
  )
    .then(({ error }) => {
      if (error) {
        logger.error({ err: error }, "platform audit write failed");
      }
    })
    .catch((err: unknown) => {
      logger.error({ err }, "platform audit write failed");
    });
}
