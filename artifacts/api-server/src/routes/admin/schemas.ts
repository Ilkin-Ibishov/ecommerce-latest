import { z } from "zod";

// Local Zod schemas for admin write endpoints that previously lacked validation
// (product / coupon / banner). No matching schemas exist in `@workspace/api-zod`,
// so they are defined here, co-located with the routes (design §3, R11.2).
//
// These are intentionally permissive: they accept every field the handlers read
// and mirror the exact payloads the admin UI sends today, so all currently-valid
// requests keep identical behavior (R11.4). Handlers still read `req.body`, so
// validation only gates malformed input (-> 400, R11.3) without changing what a
// valid handler observes. Unknown keys are stripped by Zod's default object
// behavior (never rejected), which keeps spread payloads like `{ ...banner }`
// passing.

// --- Products -------------------------------------------------------------

const ProductTranslation = z
  .object({
    lang_code: z.string(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

const ProductImage = z
  .object({
    url: z.string(),
    alt_text: z.string().nullable().optional(),
  })
  .passthrough();

const ProductSpec = z
  .object({
    spec_key: z.string(),
    spec_value: z.string(),
    sort_order: z.number().optional(),
  })
  .passthrough();

export const CreateProductSchema = z.object({
  sku: z.string().nullable().optional(),
  slug: z.string(),
  price: z.number().min(0).max(9999999),
  stock: z.number().int().min(0).max(999999),
  sort_order: z.number().optional(),
  is_featured: z.boolean().optional(),
  is_on_sale: z.boolean().optional(),
  is_deal_of_day: z.boolean().optional(),
  brand: z.string().nullable().optional(),
  original_price: z.number().min(0).max(9999999).nullable().optional(),
  translations: z.array(ProductTranslation).optional(),
  images: z.array(ProductImage).optional(),
  category_ids: z.array(z.string()).optional(),
  specs: z.array(ProductSpec).optional(),
});

// Update sends the same full payload as create in the admin UI.
export const UpdateProductSchema = CreateProductSchema;

// --- Coupons --------------------------------------------------------------

export const CreateCouponSchema = z.object({
  code: z.string(),
  description: z.string().nullable().optional(),
  discount_type: z.enum(["percentage", "fixed"]),
  discount_value: z.number(),
  min_order_amount: z.number().nullable().optional(),
  max_uses: z.number().nullable().optional(),
  max_uses_per_user: z.number().nullable().optional(),
  scope: z.string().optional(),
  scope_ids: z.array(z.string()).nullable().optional(),
  is_active: z.boolean().optional(),
  starts_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
});

// Update is a partial: the handler treats `code` as optional (`code?.toUpperCase()`)
// and tolerates missing fields, so every subset of the create payload is valid.
export const UpdateCouponSchema = CreateCouponSchema.partial();

// --- Banners --------------------------------------------------------------

export const CreateBannerSchema = z.object({
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  cta_text: z.string().nullable().optional(),
  cta_url: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  active: z.boolean().optional(),
});

// Update sends the same shape as create (including the toggle-active path which
// spreads the full banner record; extra keys like `id`/`created_at` are stripped).
export const UpdateBannerSchema = CreateBannerSchema;

// --- Orders ---------------------------------------------------------------

const OrderItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
});

export const OrderBodySchema = z.object({
  items: z.array(OrderItemSchema).min(1).max(50),
  customer_name: z.string().min(1).max(200),
  customer_phone: z.string().min(1).max(30),
  delivery_address: z.string().min(1).max(500),
  notes: z.string().max(1000).nullable().optional(),
  coupon_code: z.string().max(50).optional(),
});
