import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { getAdminSupabase } from "../../lib/supabase";
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
    .select("id, status, total_azn, discount_azn, delivery_fee_azn, customer_name, customer_phone, delivery_address, notes, created_at")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", new Date(from).toISOString());
  if (to) query = query.lte("created_at", new Date(to).toISOString());
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const orders: any[] = data ?? [];
  const headers = ["Order ID", "Status", "Customer Name", "Phone", "Address", "Notes", "Total (AZN)", "Discount (AZN)", "Delivery (AZN)", "Date"];
  const rows = orders.map((o: any) => [
    o.id.slice(0, 8).toUpperCase(),
    o.status,
    `"${(o.customer_name ?? "").replace(/"/g, '""')}"`,
    o.customer_phone ?? "",
    `"${(o.delivery_address ?? "").replace(/"/g, '""')}"`,
    `"${(o.notes ?? "").replace(/"/g, '""')}"`,
    Number(o.total_azn).toFixed(2),
    Number(o.discount_azn ?? 0).toFixed(2),
    o.delivery_fee_azn == null ? "" : Number(o.delivery_fee_azn).toFixed(2),
    new Date(o.created_at).toLocaleString("az-AZ"),
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send("\uFEFF" + csv); // BOM for Excel UTF-8
});

const UpdateOrderStatusBody = z
  .object({
    status: z
      .enum([
        "pending",
        "phone_verified",
        "courier_assigned",
        "shipped",
        "delivered",
        "refused_at_delivery",
        "cancelled",
      ])
      .optional(),
    delivery_fee_azn: z
      .string()
      .regex(/^\d{1,8}(\.\d{1,2})?$/)
      .optional(),
  })
  .refine((data) => data.status !== undefined || data.delivery_fee_azn !== undefined, {
    message: "At least one of status or delivery_fee_azn must be provided",
  });

router.patch("/admin/orders/:id/status", requireAdmin, async (req, res): Promise<void> => {
  const ctx = { admin: req.admin!, user: req.user! };
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = UpdateOrderStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, delivery_fee_azn } = parsed.data;
  const admin = ctx.admin;

  // 1. Fee present -> set_order_delivery_fee RPC
  if (delivery_fee_azn !== undefined) {
    const { error: feeErr } = await (admin as any).rpc("set_order_delivery_fee", {
      p_actor: ctx.user.id,
      p_order: rawId,
      p_fee: Number(delivery_fee_azn),
    });

    if (feeErr) {
      if (feeErr.code === "ST050" || feeErr.message?.includes("ST050")) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (feeErr.code === "ST051" || feeErr.message?.includes("ST051")) {
        res.status(409).json({ error: "fee_closed" });
        return;
      }
      res.status(500).json({ error: feeErr.message });
      return;
    }
  }

  // Read order state after step 1
  const { data: order } = await (admin as any)
    .from("orders")
    .select("id, customer_phone, customer_name, status, delivery_fee_azn, total_azn, order_items(product_id, quantity, variant_id)")
    .eq("id", rawId)
    .single();

  if (!order) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const oldStatus = order.status;
  const currentFee =
    order.delivery_fee_azn !== null && order.delivery_fee_azn !== undefined
      ? Number(order.delivery_fee_azn)
      : null;
  const currentTotal = Number(order.total_azn);

  // 2. Status present -> check fee recorded before dispatch
  if (status !== undefined) {
    const dispatchStatuses = ["courier_assigned", "shipped", "delivered"];
    if (dispatchStatuses.includes(status) && currentFee === null) {
      res.status(409).json({ error: "delivery_fee_required" });
      return;
    }

    const { error: updateErr } = await (admin as any).from("orders").update({ status }).eq("id", rawId);
    if (updateErr) {
      if (updateErr.code === "23514" || updateErr.message?.includes("chk_orders_fee_before_dispatch")) {
        res.status(409).json({ error: "delivery_fee_required" });
        return;
      }
      res.status(500).json({ error: updateErr.message });
      return;
    }

    // Insert status history record (non-blocking)
    try {
      await (getAdminSupabase() as any)
        .from("order_status_history")
        .insert({
          order_id: rawId,
          old_status: oldStatus,
          new_status: status,
          changed_by: ctx.user.id,
        });
    } catch (err: unknown) {
      req.log?.error?.({ err }, "Failed to insert status history");
    }

    if (status === "cancelled" && oldStatus !== "cancelled") {
      for (const item of order.order_items ?? []) {
        const targetId = item.variant_id ?? item.product_id;
        const { error: rpcErr } = await incrementStock(admin, targetId, item.quantity, rawId as string);
        if (rpcErr) {
          req.log?.error?.({ rpcErr, item }, "Failed to restock cancelled item");
        }
      }
      writeAudit({
        admin, req,
        actorId: ctx.user.id, action: "cancel_restock", entityType: "order", entityId: rawId as string,
        details: { items: order.order_items },
      });
    }

    writeAudit({
      admin,
      req,
      actorId: ctx.user.id,
      action: "update_order_status",
      entityType: "order",
      entityId: rawId as string,
      details: { old_status: oldStatus, status },
    });
  }

  // 3. Notifications
  if (order.customer_phone) {
    if (status !== undefined && status !== oldStatus) {
      if (status === "phone_verified") {
        queueNotification({
          type: "status_changed",
          recipient: order.customer_phone,
          payload: {
            order_id: rawId,
            status,
            old_status: oldStatus,
            delivery_fee: currentFee,
            total: currentTotal,
          },
        }).catch(() => {});
      } else {
        queueNotification({
          type: "status_changed",
          recipient: order.customer_phone,
          payload: { order_id: rawId, status, old_status: oldStatus },
        }).catch(() => {});
      }
    }

    const effectiveStatus = status ?? oldStatus;
    const isPastPending = effectiveStatus !== "pending";
    if (delivery_fee_azn !== undefined && isPastPending && status !== "phone_verified") {
      queueNotification({
        type: "delivery_fee_set",
        recipient: order.customer_phone,
        payload: {
          order_id: rawId,
          delivery_fee: currentFee ?? Number(delivery_fee_azn),
          total: currentTotal,
        },
      }).catch(() => {});
    }
  }

  res.json({ success: true, delivery_fee: currentFee, total: currentTotal });
  return;
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
