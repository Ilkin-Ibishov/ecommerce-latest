// Maps a refused (4xx) counter sale to a till message key. The server's raw text can carry
// UUIDs and English, so it is never returned: the caller logs it and shows the key.
// Codes: ST001 insufficient stock (stock trigger), ST002 variant not found (post_counter_sale).
// Bundle errors carry no code: route "Unknown or inactive bundle"; counter-pricing
// "Unknown bundle <id>" and "Variant <id> is not in bundle <id>".
export function counterSaleErrorKey(status: number, code?: string, message?: string): string {
  if (status === 401) return "Admin.Counter.sessionExpired";
  if (status === 403) return "Admin.Counter.notAllowed";
  if (status === 429) return "Admin.Counter.tooManyRequests";
  if (code === "ST001") return "Admin.Counter.outOfStock";
  if (code === "ST002") return "Admin.Counter.variantNotFound";
  if (!code && /bundle/i.test(message ?? "")) return "Admin.Counter.bundleInvalid";
  return "Admin.Counter.errorFallback";
}
