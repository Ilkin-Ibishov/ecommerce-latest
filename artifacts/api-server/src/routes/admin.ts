import { Router } from "express";
import multer from "multer";
import { requireAdmin, getAdminSupabase } from "../lib/supabase";
import { queueNotification } from "../lib/notifications";
import { sendWhatsAppTestMessage, isWhatsAppConfigured, getWhatsAppInstance } from "../lib/whatsapp";

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
    const { sku, slug, price, stock, is_featured, is_on_sale, is_deal_of_day, sort_order,
      brand, original_price, translations, images, category_ids, specs } = req.body;
    const admin = ctx.admin;

    const { data: product, error } = await (admin as any).from("products")
      .insert({
        sku: sku ?? null, slug, price, stock,
        is_featured: !!is_featured, is_on_sale: !!is_on_sale, is_deal_of_day: !!is_deal_of_day,
        sort_order: sort_order ?? 0,
        brand: brand ?? null,
        original_price: original_price ?? null,
      })
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
    if (specs?.length) {
      await (admin as any).from("product_specs").insert(specs.map((s: any) => ({ product_id: product.id, spec_key: s.spec_key, spec_value: s.spec_value, sort_order: s.sort_order ?? 0 })));
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
    const { sku, slug, price, stock, is_featured, is_on_sale, is_deal_of_day, sort_order,
      brand, original_price, translations, images, category_ids, specs } = req.body;
    const admin = ctx.admin;

    await (admin as any).from("products").update({
      sku: sku ?? null, slug, price, stock,
      is_featured: !!is_featured, is_on_sale: !!is_on_sale, is_deal_of_day: !!is_deal_of_day,
      sort_order: sort_order ?? 0,
      brand: brand ?? null,
      original_price: original_price ?? null,
    }).eq("id", id);

    await (admin as any).from("product_translations").delete().eq("product_id", id);
    if (translations?.length) await (admin as any).from("product_translations").insert(translations.map((t: any) => ({ ...t, product_id: id })));

    await (admin as any).from("product_images").delete().eq("product_id", id);
    if (images?.length) await (admin as any).from("product_images").insert(images.map((img: any, i: number) => ({ product_id: id, url: img.url, alt_text: img.alt_text ?? null, sort_order: i })));

    await (admin as any).from("product_categories").delete().eq("product_id", id);
    if (category_ids?.length) await (admin as any).from("product_categories").insert(category_ids.map((cat_id: string) => ({ product_id: id, category_id: cat_id })));

    await (admin as any).from("product_specs").delete().eq("product_id", id);
    if (specs?.length) await (admin as any).from("product_specs").insert(specs.map((s: any) => ({ product_id: id, spec_key: s.spec_key, spec_value: s.spec_value, sort_order: s.sort_order ?? 0 })));

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

// ── Banners ──────────────────────────────────────────────────────────────────

router.get("/admin/banners", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { data } = await (ctx.admin as any).from("banners").select("*").order("sort_order");
    return res.json(data ?? []);
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.post("/admin/banners", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { title, subtitle, image_url, cta_text, cta_url, sort_order, active } = req.body;
    const { data, error } = await (ctx.admin as any).from("banners").insert({
      title, subtitle: subtitle ?? null, image_url: image_url ?? null,
      cta_text: cta_text ?? null, cta_url: cta_url ?? null,
      sort_order: sort_order ?? 0, active: active ?? true,
    }).select("id").single();
    if (error) return res.status(400).json({ error: error.message });
    await (ctx.admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "create_banner", entity: "banner", entity_id: data.id, changes: req.body });
    return res.status(201).json({ id: data.id });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/admin/banners/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { title, subtitle, image_url, cta_text, cta_url, sort_order, active } = req.body;
    await (ctx.admin as any).from("banners").update({
      title, subtitle: subtitle ?? null, image_url: image_url ?? null,
      cta_text: cta_text ?? null, cta_url: cta_url ?? null,
      sort_order: sort_order ?? 0, active: !!active,
    }).eq("id", id);
    await (ctx.admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "update_banner", entity: "banner", entity_id: id, changes: req.body });
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/admin/banners/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    await (ctx.admin as any).from("banners").delete().eq("id", req.params.id);
    await (ctx.admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "delete_banner", entity: "banner", entity_id: req.params.id, changes: {} });
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

// ── Orders ────────────────────────────────────────────────────────────────────

router.patch("/admin/orders/:id/status", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
    const admin = ctx.admin;

    const { data: order } = await (admin as any)
      .from("orders")
      .select("customer_phone, customer_name, status, order_items(product_id, quantity)")
      .eq("id", id)
      .single();

    if (!order) return res.status(404).json({ error: "Order not found" });
    const oldStatus = order.status;

    await (admin as any).from("orders").update({ status }).eq("id", id);

    if (status === "cancelled" && oldStatus !== "cancelled") {
      for (const item of order.order_items ?? []) {
        const { error: rpcErr } = await (admin as any).rpc("increment_stock", {
          p_product_id: item.product_id,
          p_qty: item.quantity,
        });
        if (rpcErr) {
          const { data: prod } = await (admin as any)
            .from("products")
            .select("stock")
            .eq("id", item.product_id)
            .single();
          if (prod) {
            await (admin as any)
              .from("products")
              .update({ stock: prod.stock + item.quantity })
              .eq("id", item.product_id);
          }
        }
      }
      await (admin as any).from("audit_log").insert({
        actor_id: ctx.user.id, action: "cancel_restock", entity: "order", entity_id: id,
        changes: { items: order.order_items },
      });
    }

    if (order.customer_phone && status !== oldStatus) {
      queueNotification({
        type: "status_changed",
        recipient: order.customer_phone,
        payload: { order_id: id, status, old_status: oldStatus },
      }).catch(() => {});
    }

    await (admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "update_order_status", entity: "order", entity_id: id, changes: { old_status: oldStatus, status } });
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

// ── Categories ────────────────────────────────────────────────────────────────

router.post("/admin/categories", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { slug, icon_url, parent_id, translations } = req.body;
    const admin = ctx.admin;
    const { data: cat, error } = await (admin as any).from("categories").insert({ slug, icon_url: icon_url ?? null, parent_id: parent_id ?? null }).select("id").single();
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
    const { slug, icon_url, parent_id, translations } = req.body;
    const admin = ctx.admin;
    await (admin as any).from("categories").update({ slug, icon_url: icon_url ?? null, parent_id: parent_id ?? null }).eq("id", id);
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

// ── Coupons ───────────────────────────────────────────────────────────────────

router.post("/admin/coupons", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { code, description, discount_type, discount_value, min_order_amount, max_uses, max_uses_per_user, scope, scope_ids, is_active, starts_at, expires_at } = req.body;
    const { data, error } = await (ctx.admin as any).from("coupons").insert({
      code: code.toUpperCase(), description, discount_type, discount_value,
      min_order_amount: min_order_amount ?? null, max_uses: max_uses ?? null,
      max_uses_per_user: max_uses_per_user ?? null, scope: scope ?? "global",
      scope_ids: scope_ids ?? null, is_active: is_active ?? true,
      starts_at: starts_at ?? null, expires_at: expires_at ?? null, used_count: 0,
    }).select("id").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ id: data.id });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/admin/coupons/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { code, description, discount_type, discount_value, min_order_amount, max_uses, max_uses_per_user, scope, scope_ids, is_active, starts_at, expires_at } = req.body;
    await (ctx.admin as any).from("coupons").update({
      code: code?.toUpperCase(), description, discount_type, discount_value,
      min_order_amount: min_order_amount ?? null, max_uses: max_uses ?? null,
      max_uses_per_user: max_uses_per_user ?? null, scope: scope ?? "global",
      scope_ids: scope_ids ?? null, is_active, starts_at: starts_at ?? null, expires_at: expires_at ?? null,
    }).eq("id", req.params.id);
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

// ── WhatsApp ──────────────────────────────────────────────────────────────────

router.get("/admin/whatsapp/status", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    return res.json({
      configured: isWhatsAppConfigured(),
      instance: getWhatsAppInstance(),
    });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.post("/admin/whatsapp/test", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "phone is required" });
    const result = await sendWhatsAppTestMessage(phone);
    return res.json(result);
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.get("/admin/orders/:id/notifications", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { data, error } = await (ctx.admin as any)
      .from("notifications")
      .select("id, type, channel, recipient, status, sent_at, created_at, attempts, error_message")
      .filter("payload->>order_id", "eq", id)
      .order("created_at", { ascending: false });
    if (error) {
      if (error.code === "42P01") return res.json([]);
      throw error;
    }
    return res.json(data ?? []);
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

// ── Comments ──────────────────────────────────────────────────────────────────

router.patch("/admin/comments/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { approved } = req.body;
    await (ctx.admin as any).from("comments").update({ approved: !!approved }).eq("id", req.params.id);
    await (ctx.admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "moderate_comment", entity: "comment", entity_id: req.params.id, changes: { approved } });
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/admin/comments/:id", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    await (ctx.admin as any).from("comments").delete().eq("id", req.params.id);
    await (ctx.admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "delete_comment", entity: "comment", entity_id: req.params.id, changes: {} });
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

export default router;
