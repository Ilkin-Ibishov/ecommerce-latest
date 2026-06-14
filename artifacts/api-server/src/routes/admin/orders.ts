import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { queueNotification } from "../../lib/notifications";
import { writeAudit } from "../../lib/audit";
import { incrementStock } from "../../lib/rpc";

const router = Router();

const VALID_STATUSES = [
  "pending", "phone_verified", "courier_assigned", "shipped",
  "delivered", "refused_at_delivery", "cancelled",
];

// GET /admin/orders/export — CSV download (must be before /:id routes)
router.get("/admin/orders/export", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { status, from, to } = req.query as Record<string, string>;
  let query = (ctx.admin as any)
    .from("orders")
    .select("id, status, total_azn, discount_azn, customer_name, customer_phone, delivery_address, notes, created_at")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", new Date(from).toISOString());
  if (to) query = query.lte("created_at", new Date(to).toISOString());
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const orders: any[] = data ?? [];
  const headers = ["Order ID", "Status", "Customer Name", "Phone", "Address", "Notes", "Total (AZN)", "Discount (AZN)", "Date"];
  const rows = orders.map((o: any) => [
    o.id.slice(0, 8).toUpperCase(),
    o.status,
    `"${(o.customer_name ?? "").replace(/"/g, '""')}"`,
    o.customer_phone ?? "",
    `"${(o.delivery_address ?? "").replace(/"/g, '""')}"`,
    `"${(o.notes ?? "").replace(/"/g, '""')}"`,
    Number(o.total_azn).toFixed(2),
    Number(o.discount_azn ?? 0).toFixed(2),
    new Date(o.created_at).toLocaleString("az-AZ"),
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send("\uFEFF" + csv); // BOM for Excel UTF-8
});

router.patch("/admin/orders/:id/status", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { id } = req.params;
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
  const admin = ctx.admin;

  const { data: order } = await (admin as any)
    .from("orders")
    .select("customer_phone, customer_name, status, order_items(product_id, quantity)")
    .eq("id", id)
    .single();

  if (!order) return res.status(404).json({ error: "Order not found" });
  const oldStatus = order.status;

  await (admin as any).from("orders").update({ status }).eq("id", id);

  if (status === "cancelled" && oldStatus !== "cancelled") {
    for (const item of order.order_items ?? []) {
      const { error: rpcErr } = await incrementStock(admin, item.product_id, item.quantity);
      if (rpcErr) {
        const { data: prod } = await (admin as any)
          .from("products")
          .select("stock")
          .eq("id", item.product_id)
          .single();
        if (prod) {
          await (admin as any)
            .from("products")
            .update({ stock: prod.stock + item.quantity })
            .eq("id", item.product_id);
        }
      }
    }
    writeAudit({
      admin, req,
      actorId: ctx.user.id, action: "cancel_restock", entityType: "order", entityId: id as string,
      details: { items: order.order_items },
    });
  }

  if (order.customer_phone && status !== oldStatus) {
    queueNotification({
      type: "status_changed",
      recipient: order.customer_phone,
      payload: { order_id: id, status, old_status: oldStatus },
    }).catch(() => {});
  }

  writeAudit({ admin, req, actorId: ctx.user.id, action: "update_order_status", entityType: "order", entityId: id as string, details: { old_status: oldStatus, status } });
  return res.json({ success: true });
});

// Task 08 — Admin notes on orders
router.patch("/admin/orders/:id/notes", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { notes } = req.body;
  if (typeof notes !== "string") return res.status(400).json({ error: "notes must be a string" });
  await (ctx.admin as any).from("orders").update({ admin_notes: notes.trim() || null }).eq("id", rawId);
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "update_order_notes", entityType: "order", entityId: rawId, details: { admin_notes: notes.slice(0, 100) } });
  return res.json({ success: true });
});

router.get("/admin/orders/:id/notifications", requireAdmin, async (req, res): Promise<void> => {
  const ctx = { admin: req.admin!, user: req.user! };

  try {
    const { data, error } = await (ctx.admin as any)
      .from("notification_queue")
      .select("*")
      .eq("order_id", req.params.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    req.log.warn({ err, orderId: req.params.id }, "Failed to fetch notifications — table may not exist");
    res.json([]);
  }
});

export default router;
