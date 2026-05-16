import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";

const router = Router();

// POST /bootstrap/admin
// Creates the very first admin account. Disabled once any admin exists.
// In production, also requires BOOTSTRAP_SECRET env var to match body.secret.
router.post("/bootstrap/admin", async (req, res) => {
  try {
    const admin = getAdminSupabase();
    const { phone, name, secret } = req.body as { phone?: string; name?: string; secret?: string };

    // In production, require a shared secret to prevent open takeover
    const bootstrapSecret = process.env.BOOTSTRAP_SECRET;
    if (bootstrapSecret && secret !== bootstrapSecret) {
      return res.status(403).json({ error: "Invalid bootstrap secret." });
    }

    if (!phone?.trim()) {
      return res.status(400).json({ error: "phone is required" });
    }

    // Safety check: refuse if any admin already exists
    const { data: existing, error: checkErr } = await (admin as any)
      .from("users")
      .select("id")
      .eq("role", "admin")
      .limit(1);

    if (checkErr) return res.status(500).json({ error: checkErr.message });

    if (existing && existing.length > 0) {
      return res.status(403).json({ error: "An admin already exists. Bootstrap is disabled." });
    }

    // Create the user in Supabase Auth
    const normalizedPhone = phone.trim().startsWith("+") ? phone.trim() : "+" + phone.trim();

    const { data: authData, error: authErr } = await (admin as any).auth.admin.createUser({
      phone: normalizedPhone,
      phone_confirm: true,
      user_metadata: { full_name: name?.trim() || "Admin" },
    });

    if (authErr) {
      // If user already exists in auth, look them up
      if (authErr.message?.includes("already")) {
        const { data: { users: allUsers } } = await (admin as any).auth.admin.listUsers();
        const found = allUsers?.find((u: any) => u.phone === normalizedPhone);
        if (!found) return res.status(400).json({ error: authErr.message });

        // Upsert public.users row and set admin
        await (admin as any).from("users").upsert({
          id: found.id,
          phone: normalizedPhone,
          full_name: name?.trim() || found.user_metadata?.full_name || "Admin",
          role: "admin",
        });

        return res.json({ ok: true, message: "Existing user promoted to admin." });
      }
      return res.status(400).json({ error: authErr.message });
    }

    const userId = authData.user.id;

    // Upsert into public.users with admin role
    await (admin as any).from("users").upsert({
      id: userId,
      phone: normalizedPhone,
      full_name: name?.trim() || "Admin",
      role: "admin",
    });

    res.json({ ok: true, message: "Admin account created. You can now sign in." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /bootstrap/status — returns whether bootstrap is still available
router.get("/bootstrap/status", async (_req, res) => {
  try {
    const admin = getAdminSupabase();
    const { data, error } = await (admin as any)
      .from("users")
      .select("id")
      .eq("role", "admin")
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ available: !data || data.length === 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
