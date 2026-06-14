import { Router } from "express";
import multer from "multer";
import { getAdminSupabase } from "../../lib/supabase";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { validate } from "../../middlewares/validate";
import { CreateProductSchema, UpdateProductSchema } from "./schemas";
import { writeAudit } from "../../lib/audit";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const BUCKET = "product-images";
const ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp", "avif"];

async function ensureBucket(admin: any) {
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.find((b: any) => b.name === BUCKET)) {
    await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10485760 });
  }
}

router.post("/admin/upload", upload.single("file"), requireAdmin, async (req: any, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
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
});

router.post("/admin/products", requireAdmin, validate(CreateProductSchema), async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
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
  writeAudit({ admin, req, actorId: ctx.user.id, action: "create_product", entityType: "product", entityId: product.id, details: req.body });
  return res.status(201).json({ id: product.id });
});

// Bulk product operations — MUST be registered BEFORE the /:id routes so the
// literal "bulk-flag" / "bulk" paths are matched ahead of the `:id` param route
// (otherwise `/:id` shadows them, treating "bulk-flag"/"bulk" as a product id).
// Bulk flag update
router.patch("/admin/products/bulk-flag", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { ids, field, value } = req.body as { ids: string[]; field: string; value: boolean };
  const VALID_FIELDS = ["is_featured", "is_on_sale", "is_deal_of_day"];
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
  if (!VALID_FIELDS.includes(field)) return res.status(400).json({ error: "Invalid field" });
  await (ctx.admin as any).from("products").update({ [field]: !!value }).in("id", ids);
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "bulk_flag_products", entityType: "product", entityId: null, details: { ids, field, value } });
  return res.json({ success: true, count: ids.length });
});

// Bulk delete
router.delete("/admin/products/bulk", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
  await (ctx.admin as any).from("products").delete().in("id", ids);
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "bulk_delete_products", entityType: "product", entityId: null, details: { ids } });
  return res.json({ success: true, count: ids.length });
});

router.patch("/admin/products/:id", requireAdmin, validate(UpdateProductSchema), async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
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

  writeAudit({ admin, req, actorId: ctx.user.id, action: "update_product", entityType: "product", entityId: id as string, details: req.body });
  return res.json({ success: true });
});

router.delete("/admin/products/:id", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const { id } = req.params;
  await (ctx.admin as any).from("products").delete().eq("id", id);
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "delete_product", entityType: "product", entityId: id as string, details: {} });
  return res.json({ success: true });
});

// Task 10 — Quick stock adjustment (4-segment path, no conflict with /:id)
router.patch("/admin/products/:id/stock", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { stock } = req.body;
  if (typeof stock !== "number" || stock < 0 || !Number.isInteger(stock)) {
    return res.status(400).json({ error: "stock must be a non-negative integer" });
  }
  await (ctx.admin as any).from("products").update({ stock }).eq("id", rawId);
  writeAudit({ admin: ctx.admin, req, actorId: ctx.user.id, action: "adjust_stock", entityType: "product", entityId: rawId, details: { stock } });
  return res.json({ success: true });
});

// Task 10 — Duplicate product
router.post("/admin/products/:id/duplicate", requireAdmin, async (req, res) => {
  const ctx = { admin: req.admin!, user: req.user! };
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
  writeAudit({ admin, req, actorId: ctx.user.id, action: "duplicate_product", entityType: "product", entityId: newProduct.id, details: { source_id: rawId } });
  return res.status(201).json({ id: newProduct.id });
});

export default router;
