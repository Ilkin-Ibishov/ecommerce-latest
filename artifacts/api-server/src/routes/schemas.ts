import { z } from "zod";

// SEC-008 / 2.8 — Profile self-update: whitelist of client-writable columns ONLY.
// role/email/phone are intentionally absent. `.strict()` rejects any unexpected
// key with a loud 400 (mirroring the DB-layer role lockdown at the API edge)
// rather than silently stripping it. The `.refine()` requires at least one
// field so an empty body is rejected with "Nothing to update".
export const UpdateProfileSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200).nullable().optional(),
    default_address: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((b) => b.full_name !== undefined || b.default_address !== undefined, {
    message: "Nothing to update",
  });

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
