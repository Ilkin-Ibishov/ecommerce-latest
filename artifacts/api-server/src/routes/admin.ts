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

// GET /admin/orders/export — CSV download (must be before /:id routes)
router.get("/admin/orders/export", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { status, from, to } = req.query as Record<string, string>;
    let query = (ctx.admin as any)
      .from("orders")
      .select("id, status, total_azn, discount_azn, customer_name, customer_phone, delivery_address, notes, created_at")
      .order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (from) query = query.gte("created_at", new Date(from).toISOString());
    if (to) query = query.lte("created_at", new Date(to).toISOString());
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const orders: any[] = data ?? [];
    const headers = ["Order ID", "Status", "Customer Name", "Phone", "Address", "Notes", "Total (AZN)", "Discount (AZN)", "Date"];
    const rows = orders.map((o: any) => [
      o.id.slice(0, 8).toUpperCase(),
      o.status,
      `"${(o.customer_name ?? "").replace(/"/g, '""')}"`,
      o.customer_phone ?? "",
      `"${(o.delivery_address ?? "").replace(/"/g, '""')}"`,
      `"${(o.notes ?? "").replace(/"/g, '""')}"`,
      Number(o.total_azn).toFixed(2),
      Number(o.discount_azn ?? 0).toFixed(2),
      new Date(o.created_at).toLocaleString("az-AZ"),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send("\uFEFF" + csv); // BOM for Excel UTF-8
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

// Task 08 — Admin notes on orders
router.patch("/admin/orders/:id/notes", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { notes } = req.body;
    if (typeof notes !== "string") return res.status(400).json({ error: "notes must be a string" });
    await (ctx.admin as any).from("orders").update({ admin_notes: notes.trim() || null }).eq("id", rawId);
    await (ctx.admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "update_order_notes", entity: "order", entity_id: rawId, changes: { admin_notes: notes.slice(0, 100) } });
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

// Task 09 — Bulk product operations (must be BEFORE /:id routes)
// Bulk flag update
router.patch("/admin/products/bulk-flag", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { ids, field, value } = req.body as { ids: string[]; field: string; value: boolean };
    const VALID_FIELDS = ["is_featured", "is_on_sale", "is_deal_of_day"];
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
    if (!VALID_FIELDS.includes(field)) return res.status(400).json({ error: "Invalid field" });
    await (ctx.admin as any).from("products").update({ [field]: !!value }).in("id", ids);
    await (ctx.admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "bulk_flag_products", entity: "product", entity_id: null, changes: { ids, field, value } });
    return res.json({ success: true, count: ids.length });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

// Bulk delete
router.delete("/admin/products/bulk", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
    await (ctx.admin as any).from("products").delete().in("id", ids);
    await (ctx.admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "bulk_delete_products", entity: "product", entity_id: null, changes: { ids } });
    return res.json({ success: true, count: ids.length });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

// Task 10 — Quick stock adjustment (4-segment path, no conflict with /:id)
router.patch("/admin/products/:id/stock", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { stock } = req.body;
    if (typeof stock !== "number" || stock < 0 || !Number.isInteger(stock)) {
      return res.status(400).json({ error: "stock must be a non-negative integer" });
    }
    await (ctx.admin as any).from("products").update({ stock }).eq("id", rawId);
    await (ctx.admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "adjust_stock", entity: "product", entity_id: rawId, changes: { stock } });
    return res.json({ success: true });
  } catch (err) { req.log.error(err); return res.status(500).json({ error: "Internal server error" }); }
});

// Task 10 — Duplicate product
router.post("/admin/products/:id/duplicate", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const admin = ctx.admin;
    const [productRes, specsRes] = await Promise.all([
      (admin as any).from("products").select("*, product_translations(*), product_images(*), product_categories(category_id)").eq("id", rawId).single(),
      (admin as any).from("product_specs").select("spec_key, spec_value, sort_order").eq("product_id", rawId).order("sort_order"),
    ]);
    if (!productRes.data) return res.status(404).json({ error: "Product not found" });
    const src = productRes.data;
    const newSlug = `${src.slug}-copy-${Date.now()}`;
    const { data: newProduct, error } = await (admin as any).from("products").insert({
      sku: src.sku ? `${src.sku}-COPY` : null, slug: newSlug, price: src.price,
      stock: 0, is_featured: false, is_on_sale: src.is_on_sale, is_deal_of_day: false,
      sort_order: src.sort_order, brand: src.brand, original_price: src.original_price,
    }).select("id").single();
    if (error) return res.status(400).json({ error: error.message });
    if (src.product_translations?.length) {
      await (admin as any).from("product_translations").insert(src.product_translations.map((t: any) => ({ product_id: newProduct.id, lang_code: t.lang_code, title: `${t.title} (copy)`, description: t.description })));
    }
    if (src.product_images?.length) {
      await (admin as any).from("product_images").insert(src.product_images.map((img: any, i: number) => ({ product_id: newProduct.id, url: img.url, alt_text: img.alt_text, sort_order: i })));
    }
    if (src.product_categories?.length) {
      await (admin as any).from("product_categories").insert(src.product_categories.map((pc: any) => ({ product_id: newProduct.id, category_id: pc.category_id })));
    }
    if (specsRes.data?.length) {
      await (admin as any).from("product_specs").insert(specsRes.data.map((s: any) => ({ product_id: newProduct.id, spec_key: s.spec_key, spec_value: s.spec_value, sort_order: s.sort_order })));
    }
    await (admin as any).from("audit_log").insert({ actor_id: ctx.user.id, action: "duplicate_product", entity: "product", entity_id: newProduct.id, changes: { source_id: rawId } });
    return res.status(201).json({ id: newProduct.id });
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

router.post("/admin/notifications/:id/retry", async (req, res) => {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return res.status(403).json({ error: "Forbidden" });
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { data: notif } = await (ctx.admin as any)
      .from("notifications")
      .select("*")
      .eq("id", rawId)
      .single();
    if (!notif) return res.status(404).json({ error: "Notification not found" });
    // Re-queue using existing infrastructure — fire and forget
    queueNotification({
      userId: notif.user_id ?? undefined,
      type: notif.type,
      recipient: notif.recipient,
      payload: notif.payload,
    }).catch(() => {});
    return res.json({ success: true });
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
