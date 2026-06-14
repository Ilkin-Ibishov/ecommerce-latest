import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";

const router = Router();

router.get("/banners", async (req, res) => {
  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from("banners")
    .select("id, title, subtitle, image_url, cta_text, cta_url, sort_order")
    .eq("active", true)
    .order("sort_order");
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

export default router;
