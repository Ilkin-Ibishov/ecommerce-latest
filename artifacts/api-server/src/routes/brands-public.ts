import { Router, type IRouter } from "express";
import { getAdminSupabase } from "../lib/supabase";
import { platformStatus } from "../middlewares/platformStatus";

const router: IRouter = Router();

/**
 * GET /api/brands
 * Public endpoint — returns active brand entries ordered by sort_order asc.
 * Also includes brand_banner_enabled setting to avoid a second fetch from storefront.
 */
router.get("/brands", platformStatus("storefront_read"), async (req, res): Promise<void> => {
  const supabase = getAdminSupabase();

  const [brandsResult, settingResult] = await Promise.all([
    (supabase as any)
      .from("brand_entries")
      .select("id, name, logo_url, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    (supabase as any)
      .from("store_settings")
      .select("value")
      .eq("key", "brand_banner_enabled")
      .single(),
  ]);

  if (brandsResult.error) {
    req.log.error({ error: brandsResult.error }, "Failed to fetch brand entries");
    res.status(500).json({ error: "Failed to fetch brands" });
    return;
  }

  const brandBannerEnabled: string = settingResult.data?.value ?? "true";

  res.json({ data: brandsResult.data ?? [], brand_banner_enabled: brandBannerEnabled });
});

export default router;
