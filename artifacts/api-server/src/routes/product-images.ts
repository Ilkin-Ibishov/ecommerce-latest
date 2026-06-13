import { Router, type IRouter } from "express";
import multer from "multer";
import { requireAdmin, getAdminSupabase } from "../lib/supabase";
import { searchImages, isSearchCooldownActive } from "../lib/image-search";
import { validateBarcode, lookupBarcode } from "../lib/barcode-lookup";
import { checkDailyLimit, incrementDailyCount } from "../lib/rate-limiter";
import { validateAndUpload, AssetValidationError } from "../lib/asset-uploader";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IMAGES_PER_PRODUCT = 5;
const BARCODE_DAILY_LIMIT = 100;
const BARCODE_SERVICE_KEY = "barcode-lookup";

/** Multer configured for in-memory storage, 5 MB limit */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a scalar string from Express 5 params (can be string | string[]).
 */
function paramStr(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Verify that a product exists. Returns true if found, false otherwise.
 */
async function productExists(admin: any, productId: string): Promise<boolean> {
  const { data } = await (admin as any)
    .from("products")
    .select("id")
    .eq("id", productId)
    .single();
  return !!data;
}

/**
 * Get the current image count for a product.
 */
async function getImageCount(admin: any, productId: string): Promise<number> {
  const { count } = await (admin as any)
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  return count ?? 0;
}

/**
 * Get the next sort_order value for a product.
 */
async function getNextSortOrder(admin: any, productId: string): Promise<number> {
  const { data } = await (admin as any)
    .from("product_images")
    .select("sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return 0;
  return data[0].sort_order + 1;
}

/**
 * Extract the storage path from a Supabase public URL for deletion.
 */
function extractStoragePath(url: string): string | null {
  const marker = "/storage/v1/object/public/site-assets/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + marker.length);
  return path || null;
}

// ---------------------------------------------------------------------------
// 5.1 — Core CRUD Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/products/:id/images
 * List all images for a product, sorted by sort_order ascending.
 */
router.get("/admin/products/:id/images", async (req, res): Promise<void> => {
  const ctx = await requireAdmin(req);
  if (!ctx) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const productId = paramStr(req.params.id);

  const exists = await productExists(ctx.admin, productId);
  if (!exists) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const { data, error } = await (ctx.admin as any)
    .from("product_images")
    .select("id, product_id, url, alt_text, sort_order, source, created_at")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });

  if (error) {
    req.log.error({ error, productId }, "Failed to fetch product images");
    res.status(500).json({ error: "Failed to fetch images" });
    return;
  }

  res.json({ images: data ?? [] });
});

/**
 * POST /api/admin/products/:id/images
 * Add an image from a URL (paste, search selection, or barcode selection).
 * Body: { url: string, alt_text?: string, source: string }
 */
router.post("/admin/products/:id/images", async (req, res): Promise<void> => {
  const ctx = await requireAdmin(req);
  if (!ctx) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const productId = paramStr(req.params.id);

  const exists = await productExists(ctx.admin, productId);
  if (!exists) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const { url, alt_text, source } = req.body;

  // Validate URL
  if (typeof url !== "string" || url.trim().length === 0) {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  // Reject data URIs and blob URLs
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    res.status(400).json({ error: "Data URIs and blob URLs are not supported" });
    return;
  }

  // HTTPS-only
  if (!url.startsWith("https://")) {
    res.status(400).json({ error: "Only HTTPS image URLs are accepted" });
    return;
  }

  // Validate source
  const validSources = ["search", "barcode", "paste", "upload"];
  const resolvedSource = validSources.includes(source) ? source : "paste";

  // Max images constraint
  const currentCount = await getImageCount(ctx.admin, productId);
  if (currentCount >= MAX_IMAGES_PER_PRODUCT) {
    res.status(400).json({ error: "Maximum 5 images per product" });
    return;
  }

  // Check for duplicate URL
  const { data: duplicate } = await (ctx.admin as any)
    .from("product_images")
    .select("id")
    .eq("product_id", productId)
    .eq("url", url)
    .single();

  if (duplicate) {
    res.status(409).json({ error: "This image is already added to the product" });
    return;
  }

  const sortOrder = await getNextSortOrder(ctx.admin, productId);

  const { data: newImage, error } = await (ctx.admin as any)
    .from("product_images")
    .insert({
      product_id: productId,
      url,
      alt_text: alt_text ?? null,
      sort_order: sortOrder,
      source: resolvedSource,
    })
    .select("*")
    .single();

  if (error) {
    // Handle unique constraint violation at DB level (race condition)
    if (error.code === "23505") {
      res.status(409).json({ error: "This image is already added to the product" });
      return;
    }
    req.log.error({ error, productId, url }, "Failed to add product image");
    res.status(500).json({ error: "Failed to add image" });
    return;
  }

  req.log.info({ productId, imageId: newImage.id, source: resolvedSource }, "Product image added");
  res.status(201).json(newImage);
});

// ---------------------------------------------------------------------------
// 5.2 — Search and Barcode Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/products/:id/images/search
 * Search for candidate images via Google Images scraping.
 * Body: { query: string }
 */
router.post("/admin/products/:id/images/search", async (req, res): Promise<void> => {
  const ctx = await requireAdmin(req);
  if (!ctx) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const productId = paramStr(req.params.id);

  const exists = await productExists(ctx.admin, productId);
  if (!exists) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const { query } = req.body;

  // Validate query
  if (typeof query !== "string" || query.trim().length < 2) {
    res.status(400).json({ error: "Search query must be at least 2 characters" });
    return;
  }

  if (query.length > 200) {
    res.status(400).json({ error: "Search query is too long" });
    return;
  }

  // Check cooldown
  if (isSearchCooldownActive()) {
    res.status(429).json({ error: "Please wait before searching again" });
    return;
  }

  try {
    const images = await searchImages(query.trim());
    res.json({ images });
  } catch (error) {
    req.log.error({ error, query, productId }, "Image search failed");
    res.status(502).json({ error: "Image search unavailable" });
  }
});

/**
 * POST /api/admin/products/:id/images/barcode
 * Look up product images via barcode (EAN/UPC).
 * Body: { barcode: string }
 */
router.post("/admin/products/:id/images/barcode", async (req, res): Promise<void> => {
  const ctx = await requireAdmin(req);
  if (!ctx) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const productId = paramStr(req.params.id);

  const exists = await productExists(ctx.admin, productId);
  if (!exists) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const { barcode } = req.body;

  // Validate barcode format
  if (typeof barcode !== "string" || !validateBarcode(barcode)) {
    res.status(400).json({ error: "Invalid barcode format" });
    return;
  }

  // Check daily rate limit
  const allowed = await checkDailyLimit(BARCODE_SERVICE_KEY, BARCODE_DAILY_LIMIT);
  if (!allowed) {
    res.status(429).json({ error: "Barcode lookup daily limit exceeded" });
    return;
  }

  try {
    const result = await lookupBarcode(barcode);
    await incrementDailyCount(BARCODE_SERVICE_KEY);

    if (!result || result.images.length === 0) {
      res.json({ images: [] });
      return;
    }

    res.json({ images: result.images, title: result.title });
  } catch (error) {
    if (error instanceof Error && error.message.includes("daily limit")) {
      res.status(429).json({ error: "Barcode lookup daily limit exceeded" });
      return;
    }
    req.log.error({ error, barcode, productId }, "Barcode lookup failed");
    res.status(502).json({ error: "Barcode lookup unavailable" });
  }
});

// ---------------------------------------------------------------------------
// 5.3 — Upload Route
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/products/:id/images/upload
 * Upload an image file via multipart form data.
 * Uses the asset-uploader for validation and Supabase Storage upload.
 */
router.post(
  "/admin/products/:id/images/upload",
  upload.single("file"),
  async (req, res): Promise<void> => {
    const ctx = await requireAdmin(req);
    if (!ctx) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const productId = paramStr(req.params.id);

    const exists = await productExists(ctx.admin, productId);
    if (!exists) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    // Max images constraint (check before upload to avoid unnecessary upload)
    const currentCount = await getImageCount(ctx.admin, productId);
    if (currentCount >= MAX_IMAGES_PER_PRODUCT) {
      res.status(400).json({ error: "Maximum 5 images per product" });
      return;
    }

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: "No file provided. Use form field name 'file'." });
      return;
    }

    try {
      const result = await validateAndUpload({
        category: "product",
        file: file.buffer,
        originalName: file.originalname,
      });

      // Store the returned CDN URL as a product_image
      const sortOrder = await getNextSortOrder(ctx.admin, productId);

      const { data: newImage, error } = await (ctx.admin as any)
        .from("product_images")
        .insert({
          product_id: productId,
          url: result.url,
          alt_text: null,
          sort_order: sortOrder,
          source: "upload",
        })
        .select("*")
        .single();

      if (error) {
        req.log.error({ error, productId }, "Failed to save uploaded image record");
        res.status(500).json({ error: "Upload succeeded but failed to save image record" });
        return;
      }

      req.log.info({ productId, imageId: newImage.id, path: result.path }, "Product image uploaded");
      res.status(201).json(newImage);
    } catch (err: unknown) {
      if (err instanceof AssetValidationError) {
        // Map asset-uploader error codes to our expected responses
        if (err.statusCode === 413) {
          res.status(413).json({ error: "File exceeds 5 MB limit" });
          return;
        }
        if (err.statusCode === 415) {
          res.status(415).json({ error: "Unsupported image type" });
          return;
        }
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      req.log.error({ err, productId }, "Unexpected error uploading product image");
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

// ---------------------------------------------------------------------------
// 5.4 — Reorder and Delete Routes
// ---------------------------------------------------------------------------

/**
 * PATCH /api/admin/products/:id/images/reorder
 * Reorder images by providing image_ids in desired order.
 * Body: { image_ids: string[] }
 */
router.patch("/admin/products/:id/images/reorder", async (req, res): Promise<void> => {
  const ctx = await requireAdmin(req);
  if (!ctx) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const productId = paramStr(req.params.id);

  const exists = await productExists(ctx.admin, productId);
  if (!exists) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const { image_ids } = req.body;

  if (!Array.isArray(image_ids) || image_ids.length === 0) {
    res.status(400).json({ error: "image_ids array is required" });
    return;
  }

  // Fetch all current images for the product
  const { data: currentImages, error: fetchError } = await (ctx.admin as any)
    .from("product_images")
    .select("id")
    .eq("product_id", productId);

  if (fetchError) {
    req.log.error({ error: fetchError, productId }, "Failed to fetch images for reorder");
    res.status(500).json({ error: "Failed to reorder images" });
    return;
  }

  const currentIds = new Set((currentImages ?? []).map((img: any) => img.id));
  const providedIds = new Set(image_ids);

  // Validate: provided IDs must match exactly the product's images
  if (providedIds.size !== currentIds.size) {
    res.status(400).json({ error: "Image IDs do not match product images" });
    return;
  }

  for (const id of image_ids) {
    if (!currentIds.has(id)) {
      res.status(400).json({ error: "Image IDs do not match product images" });
      return;
    }
  }

  // Update sort_order sequentially
  for (let i = 0; i < image_ids.length; i++) {
    const { error: updateError } = await (ctx.admin as any)
      .from("product_images")
      .update({ sort_order: i })
      .eq("id", image_ids[i])
      .eq("product_id", productId);

    if (updateError) {
      req.log.error({ error: updateError, imageId: image_ids[i] }, "Failed to update sort_order");
      res.status(500).json({ error: "Failed to reorder images" });
      return;
    }
  }

  // Return the updated images
  const { data: updatedImages } = await (ctx.admin as any)
    .from("product_images")
    .select("id, product_id, url, alt_text, sort_order, source, created_at")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });

  req.log.info({ productId, order: image_ids }, "Product images reordered");
  res.json({ images: updatedImages ?? [] });
});

/**
 * DELETE /api/admin/products/:id/images/:imageId
 * Delete a single product image. Reassigns sort_order to maintain contiguity.
 * If the image was uploaded (source='upload'), also deletes from Supabase Storage.
 */
router.delete("/admin/products/:id/images/:imageId", async (req, res): Promise<void> => {
  const ctx = await requireAdmin(req);
  if (!ctx) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const productId = paramStr(req.params.id);
  const imageId = paramStr(req.params.imageId);

  const exists = await productExists(ctx.admin, productId);
  if (!exists) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  // Fetch the image to verify it belongs to this product
  const { data: image, error: fetchError } = await (ctx.admin as any)
    .from("product_images")
    .select("id, url, source, sort_order")
    .eq("id", imageId)
    .eq("product_id", productId)
    .single();

  if (fetchError || !image) {
    res.status(404).json({ error: "Image not found" });
    return;
  }

  // Delete the record
  const { error: deleteError } = await (ctx.admin as any)
    .from("product_images")
    .delete()
    .eq("id", imageId);

  if (deleteError) {
    req.log.error({ error: deleteError, imageId, productId }, "Failed to delete product image");
    res.status(500).json({ error: "Failed to delete image" });
    return;
  }

  // Reassign sort_order to maintain contiguity
  const { data: remainingImages, error: remainingError } = await (ctx.admin as any)
    .from("product_images")
    .select("id")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });

  if (!remainingError && remainingImages) {
    for (let i = 0; i < remainingImages.length; i++) {
      await (ctx.admin as any)
        .from("product_images")
        .update({ sort_order: i })
        .eq("id", remainingImages[i].id);
    }
  }

  // If uploaded image, delete from storage (fire-and-forget)
  if (image.source === "upload") {
    const storagePath = extractStoragePath(image.url);
    if (storagePath) {
      const supabase = getAdminSupabase();
      supabase.storage
        .from("site-assets")
        .remove([storagePath])
        .then(({ error: storageError }) => {
          if (storageError) {
            req.log.warn(
              { error: storageError, storagePath, imageId },
              "Failed to delete uploaded image from storage"
            );
          }
        })
        .catch((err: unknown) => {
          req.log.warn({ err, storagePath, imageId }, "Unexpected error deleting storage file");
        });
    }
  }

  req.log.info({ productId, imageId, source: image.source }, "Product image deleted");
  res.status(204).send();
});

export default router;
