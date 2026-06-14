import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";
import { requireUser } from "../middlewares/requireUser";

const router = Router();

router.get("/profile", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const admin = getAdminSupabase();
  const { data: profile, error } = await admin
    .from("users")
    .select("full_name, phone, default_address")
    .eq("id", user.id)
    .single();

  if (error) throw error;
  return res.json(profile ?? { full_name: null, phone: null, default_address: null });
});

router.patch("/profile", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const { full_name, default_address } = req.body;
  const updates: { full_name?: string | null; default_address?: string | null } = {};
  if (full_name !== undefined) updates.full_name = full_name ?? null;
  if (default_address !== undefined) updates.default_address = default_address ?? null;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const admin = getAdminSupabase();
  const { data: profile, error } = await admin
    .from("users")
    .update(updates)
    .eq("id", user.id)
    .select("full_name, phone, default_address")
    .single();

  if (error) throw error;
  return res.json(profile);
});

export default router;
