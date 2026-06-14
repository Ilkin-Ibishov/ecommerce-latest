// Typed Express Request augmentation (declared once for the whole api-server).
//
// These optional fields are attached by the auth/validation middleware:
//   - `user` / `admin`     → set by requireAdmin (admin = service-role client)
//   - `authUser`           → set by requireUser
//   - `validatedBody`      → set by validate(schema)
//
// Shared across middlewares (requireAdmin, requireUser, validate) so the
// augmentation lives in exactly one place. Picked up via tsconfig `include: ["src"]`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@workspace/supabase-types";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; [k: string]: unknown };
      admin?: SupabaseClient<Database>; // service-role client, attached by requireAdmin
      authUser?: { id: string }; // attached by requireUser
      validatedBody?: unknown; // attached by validate()
    }
  }
}

export {};
