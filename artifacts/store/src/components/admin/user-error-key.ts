import type { MessageKey } from "@/lib/i18n/messages";

// The /admin/users routes answer with an error code; the screen owns the words. An unknown code
// falls back to the generic message. Typed keys, so a missing dictionary entry fails typecheck.
const KEYS: Record<string, MessageKey> = {
  invalid_search: "Admin.Users.error.invalid_search",
  invalid_phone: "Admin.Users.error.invalid_phone",
  phone_reserved: "Admin.Users.error.phone_reserved",
  phone_ambiguous: "Admin.Users.error.phone_ambiguous",
  already_staff: "Admin.Users.error.already_staff",
  auth_create_failed: "Admin.Users.error.auth_create_failed",
  cannot_demote_self: "Admin.Users.error.cannot_demote_self",
  not_found: "Admin.Users.error.not_found",
  last_admin: "Admin.Users.error.last_admin",
};

export function userErrorKey(code: unknown): MessageKey {
  return (typeof code === "string" && KEYS[code]) || "Admin.Common.error";
}
