import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// ─── Validate environment variables ──────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  process.stderr.write("Missing SUPABASE_URL (or VITE_SUPABASE_URL) environment variable\n");
  process.exit(1);
}

if (!supabaseServiceRoleKey) {
  process.stderr.write("Missing SUPABASE_SERVICE_ROLE_KEY environment variable\n");
  process.exit(1);
}

// ─── Create Supabase client with service role key ────────────────────────────

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Seed data definitions ───────────────────────────────────────────────────

const products = [
  { slug: "test-product-1", price: 19.99, stock: 20, sku: "TST-001" },
  { slug: "test-product-2", price: 29.99, stock: 15, sku: "TST-002" },
  { slug: "test-product-3", price: 9.99, stock: 50, sku: "TST-003" },
];

const productTranslations = [
  { slug: "test-product-1", lang_code: "en", title: "Test Product 1", description: "A test product for automated testing" },
  { slug: "test-product-2", lang_code: "en", title: "Test Product 2", description: "Another test product for automated testing" },
  { slug: "test-product-3", lang_code: "en", title: "Test Product 3", description: "Third test product for automated testing" },
];

const categories = [
  { slug: "test-category-1" },
  { slug: "test-category-2" },
];

const categoryTranslations = [
  { slug: "test-category-1", lang_code: "en", title: "Test Category 1" },
  { slug: "test-category-2", lang_code: "en", title: "Test Category 2" },
];

const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

const coupons = [
  {
    code: "TEST_10PCT",
    description: "Test coupon: 10% off",
    discount_type: "percentage" as const,
    discount_value: 10,
    is_active: true,
    expires_at: oneYearFromNow,
  },
  {
    code: "TEST_5AZN",
    description: "Test coupon: 5 AZN off",
    discount_type: "fixed" as const,
    discount_value: 5,
    is_active: true,
    expires_at: oneYearFromNow,
  },
];

// ─── Seed execution ──────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  // 1. Upsert products
  const { data: upsertedProducts, error: productsError } = await supabase
    .from("products")
    .upsert(
      products.map((p) => ({
        slug: p.slug,
        price: p.price,
        stock: p.stock,
        sku: p.sku,
      })),
      { onConflict: "slug" }
    )
    .select("id, slug");

  if (productsError) {
    throw new Error(`Failed to upsert products: ${productsError.message}`);
  }

  const productMap = new Map(upsertedProducts.map((p) => [p.slug, p.id as string]));

  // 2. Upsert product_translations
  const translationRows = productTranslations.map((t) => ({
    product_id: productMap.get(t.slug)!,
    lang_code: t.lang_code,
    title: t.title,
    description: t.description,
  }));

  const { error: translationsError } = await supabase
    .from("product_translations")
    .upsert(translationRows, { onConflict: "product_id,lang_code" });

  if (translationsError) {
    throw new Error(`Failed to upsert product_translations: ${translationsError.message}`);
  }

  // 3. Upsert categories
  const { data: upsertedCategories, error: categoriesError } = await supabase
    .from("categories")
    .upsert(
      categories.map((c) => ({ slug: c.slug })),
      { onConflict: "slug" }
    )
    .select("id, slug");

  if (categoriesError) {
    throw new Error(`Failed to upsert categories: ${categoriesError.message}`);
  }

  const categoryMap = new Map(upsertedCategories.map((c) => [c.slug, c.id as string]));

  // 4. Upsert category_translations
  const catTranslationRows = categoryTranslations.map((ct) => ({
    category_id: categoryMap.get(ct.slug)!,
    lang_code: ct.lang_code,
    title: ct.title,
  }));

  const { error: catTransError } = await supabase
    .from("category_translations")
    .upsert(catTranslationRows, { onConflict: "category_id,lang_code" });

  if (catTransError) {
    throw new Error(`Failed to upsert category_translations: ${catTransError.message}`);
  }

  // 5. Upsert product_categories (link all products to both categories)
  const productCategoryRows: { product_id: string; category_id: string }[] = [];
  for (const [, productId] of productMap) {
    for (const [, categoryId] of categoryMap) {
      productCategoryRows.push({ product_id: productId, category_id: categoryId });
    }
  }

  const { error: prodCatError } = await supabase
    .from("product_categories")
    .upsert(productCategoryRows, { onConflict: "product_id,category_id" });

  if (prodCatError) {
    throw new Error(`Failed to upsert product_categories: ${prodCatError.message}`);
  }

  // 6. Upsert coupons
  const { error: couponsError } = await supabase
    .from("coupons")
    .upsert(coupons, { onConflict: "code" });

  if (couponsError) {
    throw new Error(`Failed to upsert coupons: ${couponsError.message}`);
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log(
    `✓ Seed complete: ${products.length} products, ${categories.length} categories, ${coupons.length} coupons upserted`
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
