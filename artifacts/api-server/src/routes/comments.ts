import { Router } from "express";
import type { Database } from "@workspace/supabase-types";
import { getAdminSupabase } from "../lib/supabase";
import { requireUser } from "../middlewares/requireUser";

const router = Router();

router.get("/products/:productId/comments", async (req, res) => {
  const admin = getAdminSupabase();
  const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
  const { data } = await admin
    .from("comments")
    .select("id, content, rating, created_at, users(full_name)")
    .eq("product_id", productId)
    .eq("approved", true)
    .order("created_at", { ascending: false })
    .limit(50);
  return res.json(data ?? []);
});

router.post("/products/:productId/comments", requireUser, async (req, res) => {
  const user = { id: req.authUser!.id };

  const { content, rating } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Content required" });
  if (rating !== undefined && (typeof rating !== "number" || rating < 1 || rating > 5)) {
    return res.status(400).json({ error: "Rating must be 1–5" });
  }

  const admin = getAdminSupabase();
  const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
  const insertData: Database["public"]["Tables"]["comments"]["Insert"] = {
    user_id: user.id,
    product_id: productId,
    content: content.trim(),
    approved: false,
  };
  if (rating !== undefined) insertData.rating = rating;

  const { data, error } = await admin
    .from("comments")
    .insert(insertData)
    .select("id")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({ id: data.id, pending: true });
});

export default router;
