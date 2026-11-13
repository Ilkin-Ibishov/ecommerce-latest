import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { writeAudit } from "../../lib/audit";
import { validateAzPhone, normalizePhone } from "../../lib/otp";

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

router.post("/admin/users", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { phone, full_name, role = "staff" } = req.body ?? {};

  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "Phone number is required" });
  }

  const trimmed = phone.trim();
  if (/[a-zA-Z]/.test(trimmed)) {
    return res.status(400).json({ error: "Invalid Azerbaijan phone number format" });
  }

  const normalizedPhone = normalizePhone(trimmed);
  if (!validateAzPhone(normalizedPhone)) {
    return res.status(400).json({ error: "Invalid Azerbaijan phone number format" });
  }

  if (!["staff", "admin"].includes(role)) {
    return res.status(400).json({ error: "Role must be staff or admin" });
  }

  const { data: existingUser, error: findErr } = await (ctx.admin as any)
    .from("users")
    .select("id, role, full_name")
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (findErr) return res.status(500).json({ error: findErr.message });

  if (existingUser) {
    if (existingUser.role === "staff" || existingUser.role === "admin") {
      return res.status(400).json({ error: "User already exists with staff or admin role" });
    }

    const updatePayload: { role: string; full_name?: string } = { role };
    if (typeof full_name === "string" && full_name.trim()) {
      updatePayload.full_name = full_name.trim();
    }

    const { error: updateErr } = await (ctx.admin as any)
      .from("users").update(updatePayload).eq("id", existingUser.id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    const finalName = updatePayload.full_name ?? existingUser.full_name;
    writeAudit({
      admin: ctx.admin, req, actorId: ctx.user.id,
      action: "create_staff", entityType: "user", entityId: existingUser.id,
      details: { phone: normalizedPhone, full_name: finalName, role, promoted_from: existingUser.role },
    });

    return res.json({
      success: true,
      user: { id: existingUser.id, phone: normalizedPhone, full_name: finalName, role },
      promoted: true,
    });
  }

  let userId: string;
  const { data: created, error: createErr } = await (ctx.admin as any).auth.admin.createUser({
    phone: normalizedPhone,
    phone_confirm: true,
  });

  if (createErr) {
    const authPhone = normalizedPhone.replace(/^\+/, "");
    const listResult = await (ctx.admin as any).auth?.admin?.listUsers?.({ perPage: 1000 });
    const found = listResult?.data?.users?.find(
      (u: any) => u.phone === authPhone || u.phone === normalizedPhone,
    );
    if (!found) return res.status(400).json({ error: createErr.message });
    userId = found.id;
  } else {
    userId = created.user.id;
  }

  const newUserData = {
    id: userId,
    phone: normalizedPhone,
    full_name: typeof full_name === "string" && full_name.trim() ? full_name.trim() : null,
    role,
  };

  const { error: insertErr } = await (ctx.admin as any).from("users").insert(newUserData);
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  writeAudit({
    admin: ctx.admin, req, actorId: ctx.user.id,
    action: "create_staff", entityType: "user", entityId: userId,
    details: { phone: normalizedPhone, full_name: newUserData.full_name, role },
  });

  return res.status(201).json({ success: true, user: newUserData });
});

router.patch("/admin/users/:id/role", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { role } = req.body;
  if (!["admin", "staff", "customer"].includes(role)) {
    return res.status(400).json({ error: "role must be admin, staff, or customer" });
  }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (rawId === ctx.user.id && role !== "admin") {
    return res.status(400).json({ error: "Cannot remove your own admin role" });
  }

  await (ctx.admin as any).from("users").update({ role }).eq("id", rawId);
  writeAudit({
    admin: ctx.admin, req, actorId: ctx.user.id,
    action: "change_user_role", entityType: "user", entityId: rawId, details: { role },
  });

  return res.json({ success: true });
});

export default router;
