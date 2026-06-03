import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";

const router = Router();

// GET /api/search/suggest?q=...&locale=az
router.get("/search/suggest", async (req, res): Promise<void> => {
  const q = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const locale = Array.isArray(req.query.locale) ? req.query.locale[0] : req.query.locale;

  const query = (typeof q === "string" ? q : "").trim();
  const lang = typeof locale === "string" ? locale : "az";

  if (query.length < 2) {
    res.json({ products: [], categories: [] });
    return;
  }

  const admin = getAdminSupabase();
  const pattern = `%${query}%`;

  // Fetch top 6 product suggestions
  const productsPromise = (admin as any)
    .from("product_translations")
    .select("product_id, title, products(id, slug, price, product_images(url, sort_order))")
    .eq("lang_code", lang)
    .ilike("title", pattern)
    .limit(6)
    .then(({ data }: any) =>
      (data ?? []).map((pt: any) => ({
        id: pt.products?.id ?? pt.product_id,
        slug: pt.products?.slug,
        title: pt.title,
        price: pt.products?.price,
        image: pt.products?.product_images
          ?.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))?.[0]?.url ?? null,
      }))
    );

  // Fetch top 3 category suggestions
  const categoriesPromise = (admin as any)
    .from("category_translations")
    .select("category_id, title, categories(id, slug)")
    .eq("lang_code", lang)
    .ilike("title", pattern)
    .limit(3)
    .then(({ data }: any) =>
      (data ?? []).map((ct: any) => ({
        id: ct.categories?.id ?? ct.category_id,
        slug: ct.categories?.slug,
        title: ct.title,
      }))
    );

  const [products, categories] = await Promise.all([productsPromise, categoriesPromise]);

  res.json({ products, categories });
});

export default router;
