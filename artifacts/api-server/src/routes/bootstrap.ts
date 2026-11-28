import { Router } from "express";
import { timingSafeEqual } from "crypto";
import { getAdminSupabase } from "../lib/supabase";
import { normalizePhone, validateAzPhone, isBypassPhone } from "../lib/otp";

const router = Router();

// POST /bootstrap/admin
// Creates the very first admin account. Disabled once any admin exists.
// In production, also requires BOOTSTRAP_SECRET env var to match body.secret.
router.post("/bootstrap/admin", async (req, res): Promise<void> => {
  const admin = getAdminSupabase();
  const { phone, name, secret } = req.body as { phone?: string; name?: string; secret?: string };

  // Fail-closed: if secret is not configured, reject all attempts
  const bootstrapSecret = process.env.BOOTSTRAP_SECRET;
  if (!bootstrapSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  const secretBuffer = Buffer.from(bootstrapSecret, "utf8");
  const providedBuffer = Buffer.from(secret ?? "", "utf8");

  if (
    secretBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(secretBuffer, providedBuffer)
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!phone?.trim()) {
    res.status(400).json({ error: "phone is required" });
    return;
  }

  // Safety check: refuse if any admin already exists
  const { data: existing, error: checkErr } = await (admin as any)
    .from("users")
    .select("id")
    .eq("role", "admin")
    .limit(1);

  if (checkErr) {
    res.status(500).json({ error: checkErr.message });
    return;
  }

  if (existing && existing.length > 0) {
    res.status(403).json({ error: "An admin already exists. Bootstrap is disabled." });
    return;
  }

  // Same phone rules as the staff routes: canonical form, a valid Azerbaijan number, never a test
  // phone (those accept a fixed code; one must not hold a role).
  const normalizedPhone = normalizePhone(phone.trim());
  if (!validateAzPhone(normalizedPhone)) {
    res.status(400).json({ error: "invalid_phone" });
    return;
  }
  if (isBypassPhone(normalizedPhone)) {
    res.status(400).json({ error: "phone_reserved" });
    return;
  }
  const fullName = name?.trim() || "Admin";

  let userId: string;
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    phone: normalizedPhone,
    phone_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (authErr) {
    // The auth user may already exist: find it by phone (auth stores digits only).
    const { data: foundId, error: findErr } = await admin.rpc("find_auth_user_by_phone", {
      p_phone: normalizedPhone.replace(/^\+/, ""),
    });
    if (findErr || !foundId) {
      res.status(400).json({ error: authErr.message });
      return;
    }
    userId = foundId;
  } else {
    userId = authData.user.id;
  }

  // Profile first (the auth trigger may have created it), then the role through the one writer of
  // roles, which also writes the audit line. The new admin is the actor of their own bootstrap.
  const { error: profileErr } = await admin
    .from("users")
    .upsert({ id: userId, phone: normalizedPhone, full_name: fullName }, { onConflict: "id" });
  if (profileErr) {
    res.status(500).json({ error: "profile_write_failed" });
    return;
  }
  const { error: roleErr } = await admin.rpc("set_user_role", { p_actor: userId, p_user: userId, p_role: "admin" });
  if (roleErr) {
    res.status(500).json({ error: "role_write_failed" });
    return;
  }

  res.json({ ok: true, message: authErr ? "Existing user promoted to admin." : "Admin account created. You can now sign in." });
});

// GET /bootstrap/status — returns whether bootstrap is still available
router.get("/bootstrap/status", async (_req, res): Promise<void> => {
  const admin = getAdminSupabase();
  const { data, error } = await (admin as any)
    .from("users")
    .select("id")
    .eq("role", "admin")
    .limit(1);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ available: !data || data.length === 0 });
});

export default router;
