import { Router } from "express";
import { getSupabase, getAdminSupabase } from "../lib/supabase";

const router = Router();

router.get("/profile", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const admin = getAdminSupabase();
    const { data: profile, error } = await (admin as any)
      .from("users")
      .select("full_name, phone, default_address")
      .eq("id", user.id)
      .single();

    if (error) throw error;
    return res.json(profile ?? { full_name: null, phone: null, default_address: null });
  } catch (err) {
    req.log.error(err, "[Profile GET] Error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/profile", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { full_name, default_address } = req.body;
    const updates: Record<string, any> = {};
    if (full_name !== undefined) updates.full_name = full_name ?? null;
    if (default_address !== undefined) updates.default_address = default_address ?? null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const admin = getAdminSupabase();
    const { data: profile, error } = await (admin as any)
      .from("users")
      .update(updates)
      .eq("id", user.id)
      .select("full_name, phone, default_address")
      .single();

    if (error) throw error;
    return res.json(profile);
  } catch (err) {
    req.log.error(err, "[Profile PATCH] Error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
