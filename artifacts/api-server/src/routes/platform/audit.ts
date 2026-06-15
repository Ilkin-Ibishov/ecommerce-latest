/**
 * Platform audit read route.
 *
 * Feature: super-admin-platform
 * Requirements: 11.3, 11.4, 11.5
 *
 * Endpoint:
 *   GET /platform/audit?store_id= — Newest-first, ≤100 entries, optional Store filter
 *
 * All access requires `requireSuperAdmin`. The shaping (ordering, cap, filter
 * validation) is delegated to the pure `shapeAuditQuery()` from
 * `lib/platform/audit-query.ts`.
 */
import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { requireSuperAdmin } from "../../middlewares/requireSuperAdmin";
import { getControlPlaneSupabase } from "../../lib/control-plane-supabase";
import {
  shapeAuditQuery,
  type AuditEntry,
  type AuditQueryParams,
} from "../../lib/platform/audit-query";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /platform/audit — Read platform audit entries (R11.3, R11.4, R11.5)
// ---------------------------------------------------------------------------
router.get(
  "/platform/audit",
  requireSuperAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const storeIdParam = req.query.store_id;
    const storeId =
      typeof storeIdParam === "string" ? storeIdParam : undefined;

    const cp = getControlPlaneSupabase();

    // Fetch audit entries from the control-plane DB (scope = 'platform').
    // We fetch a generous set and let the shaper handle ordering + cap.
    const { data: rows, error } = await cp
      .from("audit_log")
      .select("id, actor_id, action, entity, entity_id, changes, scope, store_id, created_at")
      .eq("scope", "platform")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      req.log?.error?.({ err: error }, "audit query failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    // Pass through the pure shaper for filter validation, ordering, and cap
    const params: AuditQueryParams = {};
    if (storeId != null) {
      params.store_id = storeId;
    }

    const result = shapeAuditQuery((rows ?? []) as AuditEntry[], params);

    if (result.error) {
      // R11.5: Invalid store filter → 400, no entries returned
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ data: result.data });
  },
);

export default router;
