import { Router } from "express";
import multer from "multer";
import { requireAdmin, getAdminSupabase } from "../lib/supabase";
import { sendWhatsAppStatusUpdate } from "../lib/whatsapp";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const BUCKET = "product-images";
const ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp", "avif"];

const VALID_STATUSES = [
  "pending", "phone_verified", "courier_assigned", "shipped",
  "delivered", "refused_at_delivery", "cancelled",
];

async function ensureBucket(admin: any) {
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.find((b: any) => b.name === BUCKET)) {
    await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10485760 });
  }
}

router.post("/admin/upload", upload.single("file"), async (req: any, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided" });
    const ext = (file.originalname.split(".").pop() ?? "jpg").toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) return res.status(400).json({ error: "File type not allowed" });

    const admin = getAdminSupabase();
    await ensureBucket(admin);
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await admin.storage.from(BUCKET).upload(fileName, file.buffer, {
      contentType: file.mimetype, upsert: false,
    });
    if (error) return res.status(500).json({ error: error.message });
    const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(fileName);
    return res.json({ url: publicUrl });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.post("/admin/products", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { slug, price, stock, is_featured, is_on_sale, is_deal_of_day, sort_order, translations, images, category_ids } = req.body;
    const admin = ctx.admin;

    const { data: product, error } = await (admin as any).from("products")
      .insert({ slug, price, stock, is_featured: !!is_featured, is_on_sale: !!is_on_sale, is_deal_of_day: !!is_deal_of_day, sort_order: sort_order ?? 0 })
      .select("id").single();
    if (error) return res.status(400).json({ error: error.message });

    if (translations?.length) {
      await (admin as any).from("product_translations").insert(translations.map((t: any) => ({ ...t, product_id: product.id })));
    }
    if (images?.length) {
      await (admin as any).from("product_images").insert(images.map((img: any, i: number) => ({ product_id: product.id, url: img.url, alt_text: img.alt_text ?? null, sort_order: i })));
    }
    if (category_ids?.length) {
      await (admin as any).from("product_categories").insert(category_ids.map((cat_id: string) => ({ product_id: product.id, category_id: cat_id })));
    }
    await (admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "create_product", entity: "product", entity_id: product.id, changes: req.body });
    return res.status(201).json({ id: product.id });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/admin/products/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { slug, price, stock, is_featured, is_on_sale, is_deal_of_day, sort_order, translations, images, category_ids } = req.body;
    const admin = ctx.admin;

    await (admin as any).from("products").update({ slug, price, stock, is_featured: !!is_featured, is_on_sale: !!is_on_sale, is_deal_of_day: !!is_deal_of_day, sort_order: sort_order ?? 0 }).eq("id", id);
    await (admin as any).from("product_translations").delete().eq("product_id", id);
    if (translations?.length) await (admin as any).from("product_translations").insert(translations.map((t: any) => ({ ...t, product_id: id })));
    await (admin as any).from("product_images").delete().eq("product_id", id);
    if (images?.length) await (admin as any).from("product_images").insert(images.map((img: any, i: number) => ({ product_id: id, url: img.url, alt_text: img.alt_text ?? null, sort_order: i })));
    await (admin as any).from("product_categories").delete().eq("product_id", id);
    if (category_ids?.length) await (admin as any).from("product_categories").insert(category_ids.map((cat_id: string) => ({ product_id: id, category_id: cat_id })));
    await (admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "update_product", entity: "product", entity_id: id, changes: req.body });
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/admin/products/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    await (ctx.admin as any).from("products").delete().eq("id", id);
    await (ctx.admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "delete_product", entity: "product", entity_id: id, changes: {} });
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/admin/orders/:id/status", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
    const admin = ctx.admin;
    const { data: order } = await (admin as any).from("orders").update({ status }).eq("id", id).select("customer_phone, customer_name").single();
    if (order) await sendWhatsAppStatusUpdate(order.customer_phone, id, status);
    await (admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "update_order_status", entity: "order", entity_id: id, changes: { status } });
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.post("/admin/categories", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { slug, icon_url, translations } = req.body;
    const admin = ctx.admin;
    const { data: cat, error } = await (admin as any).from("categories").insert({ slug, icon_url: icon_url ?? null }).select("id").single();
    if (error) return res.status(400).json({ error: error.message });
    if (translations?.length) await (admin as any).from("category_translations").insert(translations.map((t: any) => ({ ...t, category_id: cat.id })));
    return res.status(201).json({ id: cat.id });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/admin/categories/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { slug, icon_url, translations } = req.body;
    const admin = ctx.admin;
    await (admin as any).from("categories").update({ slug, icon_url: icon_url ?? null }).eq("id", id);
    await (admin as any).from("category_translations").delete().eq("category_id", id);
    if (translations?.length) await (admin as any).from("category_translations").insert(translations.map((t: any) => ({ ...t, category_id: id })));
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/admin/categories/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    await (ctx.admin as any).from("categories").delete().eq("id", req.params.id);
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.post("/admin/coupons", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { code, description, discount_type, discount_value, min_order_amount, max_uses, is_active, expires_at } = req.body;
    const { data, error } = await (ctx.admin as any).from("coupons").insert({ code: code.toUpperCase(), description, discount_type, discount_value, min_order_amount, max_uses, is_active, expires_at, used_count: 0 }).select("id").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ id: data.id });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/admin/coupons/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { code, description, discount_type, discount_value, min_order_amount, max_uses, is_active, expires_at } = req.body;
    await (ctx.admin as any).from("coupons").update({ code: code?.toUpperCase(), description, discount_type, discount_value, min_order_amount, max_uses, is_active, expires_at }).eq("id", req.params.id);
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/admin/coupons/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    await (ctx.admin as any).from("coupons").delete().eq("id", req.params.id);
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/admin/comments/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { approved } = req.body;
    await (ctx.admin as any).from("comments").update({ approved: !!approved }).eq("id", req.params.id);
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/admin/comments/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    await (ctx.admin as any).from("comments").delete().eq("id", req.params.id);
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

export default router;
