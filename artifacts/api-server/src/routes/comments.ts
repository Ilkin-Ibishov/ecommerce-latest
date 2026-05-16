import { Router } from "express";
import { getSupabase, getAdminSupabase } from "../lib/supabase";

const router = Router();

router.get("/products/:productId/comments", async (req, res) => {
  try {
    const admin = getAdminSupabase();
    const { data } = await (admin as any)
      .from("comments")
      .select("id, content, created_at, users(full_name)")
      .eq("product_id", req.params.productId)
      .eq("approved", true)
      .order("created_at", { ascending: false })
      .limit(50);
    return res.json(data ?? []);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/products/:productId/comments", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabase(token);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: "Content required" });

    const admin = getAdminSupabase();
    const { data, error } = await (admin as any)
      .from("comments")
      .insert({
        user_id: user.id,
        product_id: req.params.productId,
        content: content.trim(),
        approved: false,
      })
      .select("id")
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ id: data.id, pending: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
