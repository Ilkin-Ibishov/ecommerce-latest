import { describe, it, expect } from "vitest";
import { counterSaleErrorKey } from "@/components/admin/counter/counterSaleError";

describe("counterSaleErrorKey", () => {
  it("maps statuses and codes to till keys", () => {
    expect(counterSaleErrorKey(401)).toBe("Admin.Counter.sessionExpired");
    expect(counterSaleErrorKey(403)).toBe("Admin.Counter.notAllowed");
    expect(counterSaleErrorKey(429)).toBe("Admin.Counter.tooManyRequests");
    expect(counterSaleErrorKey(409, "ST001")).toBe("Admin.Counter.outOfStock");
    expect(counterSaleErrorKey(400, "ST002")).toBe("Admin.Counter.variantNotFound");
    expect(counterSaleErrorKey(400, undefined, "Unknown or inactive bundle")).toBe("Admin.Counter.bundleInvalid");
  });

  it("falls back for unknown errors and never returns raw text with a UUID", () => {
    const msg = "Variant 3f2b8c1e-9a4d-4e6b-8c2f-1a2b3c4d5e6f is not in bundle 0b9d6f2a-1c3e-4d5f-8a7b-6c5d4e3f2a1b";
    expect(counterSaleErrorKey(400, "ST999")).toBe("Admin.Counter.errorFallback");
    expect(counterSaleErrorKey(422, undefined, "weird")).toBe("Admin.Counter.errorFallback");
    expect(counterSaleErrorKey(400, undefined, msg)).not.toContain("3f2b8c1e");
    expect(counterSaleErrorKey(400, "ST999", msg)).not.toContain("3f2b8c1e");
  });
});
