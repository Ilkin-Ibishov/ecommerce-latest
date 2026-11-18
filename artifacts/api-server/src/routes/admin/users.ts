import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { normalizePhone, validateAzPhone, isBypassPhone } from "../../lib/otp";

const router = Router();

const SEARCH_PATTERN = /^[\p{L}\p{N} +\-.']*$/u;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GetUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  role: z.enum(["customer", "staff", "admin"]).optional(),
  q: z.string().optional(),
});

const CreateUserBodySchema = z.object({
  phone: z.string().min(1),
  full_name: z.string().nullable().optional(),
  role: z.enum(["staff", "admin"]).default("staff"),
});

const PatchRoleBodySchema = z.object({
  role: z.enum(["customer", "staff", "admin"]),
});

router.get("/admin/users", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const parsed = GetUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_search" });
    return;
  }

  const { page, role, q } = parsed.data;
  const rawQ = q?.trim() ?? "";
  if (rawQ) {
    if (rawQ.length > 50 || !SEARCH_PATTERN.test(rawQ)) {
      res.status(400).json({ error: "invalid_search" });
      return;
    }
  }

  const ctx = { admin: req.admin!, user: req.user! };
  const pageSize = 30;
  const offset = (page - 1) * pageSize;

  let query = ctx.admin
    .from("users")
    .select("id, phone, full_name, role, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (role) {
    query = query.eq("role", role);
  }

  if (rawQ) {
    const term = `%${rawQ}%`;
    query = query.or(`full_name.ilike.${term},phone.ilike.${term}`);
  }

  const { data: users, count, error } = await query;
  if (error) {
    req.log.error({ err: error }, "Failed to query users");
    res.status(500).json({ error: error.message });
    return;
  }

  const userList = users ?? [];
  const userIds = userList.map((u) => u.id);
  const orderCounts: Record<string, number> = {};
  if (userIds.length > 0) {
    const { data: orders } = await ctx.admin
      .from("orders")
      .select("user_id")
      .in("user_id", userIds);
    (orders ?? []).forEach((o) => {
      if (o.user_id) {
        orderCounts[o.user_id] = (orderCounts[o.user_id] ?? 0) + 1;
      }
    });
  }

  res.status(200).json({
    users: userList.map((u) => ({
      ...u,
      order_count: orderCounts[u.id] ?? 0,
    })),
    total: count ?? 0,
    page,
    pageSize,
  });
  return;
});

router.post("/admin/users", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateUserBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_phone" });
    return;
  }

  const { phone, full_name, role: targetRole } = parsed.data;
  const trimmedPhone = phone.trim();

  if (/[^\d+\s\-()]/.test(trimmedPhone)) {
    res.status(400).json({ error: "invalid_phone" });
    return;
  }

  const canonicalPhone = normalizePhone(trimmedPhone);
  if (!validateAzPhone(canonicalPhone)) {
    res.status(400).json({ error: "invalid_phone" });
    return;
  }

  if (isBypassPhone(canonicalPhone)) {
    res.status(400).json({ error: "phone_reserved" });
    return;
  }

  const digitsPhone = canonicalPhone.replace(/^\+/, "");
  const ctx = { admin: req.admin!, user: req.user! };

  const { data: existingRows, error: findErr } = await ctx.admin
    .from("users")
    .select("id, phone, full_name, role")
    .in("phone", [canonicalPhone, digitsPhone]);

  if (findErr) {
    req.log.error({ err: findErr }, "Failed to find existing user by phone");
    res.status(500).json({ error: findErr.message });
    return;
  }

  const rows = existingRows ?? [];
  if (rows.length > 1) {
    res.status(409).json({ error: "phone_ambiguous" });
    return;
  }

  if (rows.length === 1) {
    const existingUser = rows[0];
    if (existingUser.role === "staff" || existingUser.role === "admin") {
      res.status(409).json({ error: "already_staff" });
      return;
    }

    const trimmedName = full_name?.trim();
    if (trimmedName) {
      const { error: updateErr } = await ctx.admin
        .from("users")
        .update({ full_name: trimmedName, phone: canonicalPhone })
        .eq("id", existingUser.id);
      if (updateErr) {
        req.log.error({ err: updateErr }, "Failed to update existing user profile");
        res.status(500).json({ error: updateErr.message });
        return;
      }
    } else if (existingUser.phone !== canonicalPhone) {
      await ctx.admin
        .from("users")
        .update({ phone: canonicalPhone })
        .eq("id", existingUser.id);
    }

    const { error: rpcErr } = await ctx.admin.rpc("set_user_role", {
      p_actor: ctx.user.id,
      p_user: existingUser.id,
      p_role: targetRole,
    });
    if (rpcErr) {
      req.log.error({ err: rpcErr }, "Failed to promote customer via set_user_role");
      res.status(500).json({ error: rpcErr.message });
      return;
    }

    const finalName = trimmedName || existingUser.full_name;
    res.status(200).json({
      success: true,
      user: {
        id: existingUser.id,
        phone: canonicalPhone,
        full_name: finalName,
        role: targetRole,
      },
      promoted: true,
    });
    return;
  }

  let userId: string;
  const { data: createdAuth, error: createErr } = await ctx.admin.auth.admin.createUser({
    phone: canonicalPhone,
    phone_confirm: true,
  });

  if (createErr) {
    req.log.warn({ err: createErr }, "auth.admin.createUser failed; searching auth.users by phone");
    const { data: authUserId, error: findAuthErr } = await ctx.admin.rpc(
      "find_auth_user_by_phone",
      { p_phone: digitsPhone },
    );
    if (findAuthErr || !authUserId) {
      req.log.error({ err: findAuthErr || createErr }, "Auth user creation and fallback search failed");
      res.status(502).json({ error: "auth_create_failed" });
      return;
    }
    userId = authUserId;
  } else {
    userId = createdAuth.user.id;
  }

  const trimmedName = full_name?.trim() || null;
  const { error: upsertErr } = await ctx.admin
    .from("users")
    .upsert(
      {
        id: userId,
        phone: canonicalPhone,
        full_name: trimmedName,
      },
      // DO NOTHING on conflict (design note §3): an existing profile keeps its name and phone.
      { onConflict: "id", ignoreDuplicates: true },
    );

  if (upsertErr) {
    req.log.error({ err: upsertErr }, "Failed to insert user profile");
    res.status(500).json({ error: upsertErr.message });
    return;
  }

  const { error: rpcErr } = await ctx.admin.rpc("set_user_role", {
    p_actor: ctx.user.id,
    p_user: userId,
    p_role: targetRole,
  });

  if (rpcErr) {
    req.log.error({ err: rpcErr }, "Failed to set initial user role via set_user_role");
    res.status(500).json({ error: rpcErr.message });
    return;
  }

  res.status(201).json({
    success: true,
    user: {
      id: userId,
      phone: canonicalPhone,
      full_name: trimmedName,
      role: targetRole,
    },
  });
  return;
});

router.patch("/admin/users/:id/role", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!rawId || !UUID_REGEX.test(rawId)) {
    res.status(400).json({ error: "not_found" });
    return;
  }

  const parsed = PatchRoleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "not_found" });
    return;
  }

  const { role: newRole } = parsed.data;
  const ctx = { admin: req.admin!, user: req.user! };

  if (rawId === ctx.user.id && newRole !== "admin") {
    res.status(400).json({ error: "cannot_demote_self" });
    return;
  }

  const { data: targetUser, error: targetErr } = await ctx.admin
    .from("users")
    .select("id, phone, role")
    .eq("id", rawId)
    .maybeSingle();

  if (targetErr) {
    req.log.error({ err: targetErr }, "Failed to find target user for role update");
    res.status(500).json({ error: targetErr.message });
    return;
  }

  if (!targetUser) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  if (targetUser.phone && isBypassPhone(targetUser.phone) && newRole !== "customer") {
    res.status(400).json({ error: "phone_reserved" });
    return;
  }

  if (targetUser.role === newRole) {
    res.status(200).json({ success: true, old_role: targetUser.role, new_role: newRole });
    return;
  }

  const { data: oldRole, error: rpcErr } = await ctx.admin.rpc("set_user_role", {
    p_actor: ctx.user.id,
    p_user: rawId,
    p_role: newRole,
  });

  if (rpcErr) {
    if (rpcErr.code === "ST040" || rpcErr.message?.includes("ST040")) {
      res.status(409).json({ error: "last_admin" });
      return;
    }
    if (rpcErr.code === "ST041" || rpcErr.message?.includes("ST041")) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    req.log.error({ err: rpcErr }, "set_user_role failed");
    res.status(500).json({ error: rpcErr.message });
    return;
  }

  res.status(200).json({
    success: true,
    old_role: oldRole ?? targetUser.role,
    new_role: newRole,
  });
  return;
});

export default router;
