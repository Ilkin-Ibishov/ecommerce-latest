import { Router } from "express";
import { getAdminSupabase } from "../lib/supabase";
import { requireUser } from "../middlewares/requireUser";
import { validate } from "../middlewares/validate";
import { UpdateProfileSchema } from "./schemas";

// Re-export so the schema is importable from `routes/profile` as well as
// `routes/schemas` (test-first contract resolves either location).
export { UpdateProfileSchema } from "./schemas";

const router = Router();

// GET /profile — Express 5 convention: early-return, no try/catch-for-500.
router.get("/profile", requireUser, async (req, res): Promise<void> => {
  const userId = req.authUser!.id;

  const admin = getAdminSupabase();
  const { data: profile, error } = await admin
    .from("users")
    .select("full_name, phone, default_address")
    .eq("id", userId)
    .single();

  if (error) throw error; // central errorHandler → generic 500
  res.json(profile ?? { full_name: null, phone: null, default_address: null });
  return;
});

// PATCH /profile — SEC-008: Zod validate + service-role write, id from token.
router.patch(
  "/profile",
  requireUser,
  validate(UpdateProfileSchema),
  async (req, res): Promise<void> => {
    const userId = req.authUser!.id; // target id from token, never body
    const body = req.validatedBody as {
      full_name?: string | null;
      default_address?: string | null;
    };

    const updates: { full_name?: string | null; default_address?: string | null } = {};
    if (body.full_name !== undefined) updates.full_name = body.full_name ?? null;
    if (body.default_address !== undefined) updates.default_address = body.default_address ?? null;

    const admin = getAdminSupabase(); // service role bypasses RLS + trigger
    const { data: profile, error } = await admin
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select("full_name, phone, default_address")
      .single();

    if (error) throw error; // central errorHandler → generic 500
    res.json(profile);
    return;
  },
);

export default router;
