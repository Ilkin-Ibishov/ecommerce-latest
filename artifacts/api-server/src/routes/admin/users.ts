import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { writeAudit } from "../../lib/audit";

const router = Router();

router.get("/admin/users", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const pageSize = 30;
  const offset = (page - 1) * pageSize;
  const q = String(req.query.q ?? "").trim();

  let query = (ctx.admin as any)
    .from("users")
    .select("id, phone, full_name, role, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (q) {
    const term = `%${q}%`;
    query = query.or(`full_name.ilike.${term},phone.ilike.${term}`);
  }

  const { data: users, count, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch order counts for this page's users in a single query
  const userIds = (users ?? []).map((u: any) => u.id);
  const orderCounts: Record<string, number> = {};
  if (userIds.length > 0) {
    const { data: orders } = await (ctx.admin as any)
      .from("orders").select("user_id").in("user_id", userIds);
    (orders ?? []).forEach((o: any) => {
      orderCounts[o.user_id] = (orderCounts[o.user_id] ?? 0) + 1;
    });
  }

  return res.json({
    users: (users ?? []).map((u: any) => ({ ...u, order_count: orderCounts[u.id] ?? 0 })),
    total: count ?? 0,
    page,
    pageSize,
  });
});

router.patch("/admin/users/:id/role", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };

  const { role } = req.body;
  if (!["admin", "customer"].includes(role)) {
    return res.status(400).json({ error: "role must be admin or customer" });
  }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Prevent self-demotion
  if (rawId === ctx.user.id && role !== "admin") {
    return res.status(400).json({ error: "Cannot remove your own admin role" });
  }

  await (ctx.admin as any).from("users").update({ role }).eq("id", rawId);
  writeAudit({
    admin: ctx.admin, req,
    actorId: ctx.user.id, action: "change_user_role",
    entityType: "user", entityId: rawId, details: { role },
  });

  return res.json({ success: true });
});

export default router;
