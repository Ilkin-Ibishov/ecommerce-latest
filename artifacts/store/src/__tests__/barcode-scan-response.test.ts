import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin-fetch", () => ({ adminJson: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiUrl: (p: string) => p }));

import { adminJson } from "@/lib/admin-fetch";
import { scanBarcode, toScanMatches } from "@/lib/barcode-scan";

const match = { variant: { id: "v1", sku: "S1", pack_quantity: 6 }, product: { id: "p1", title: "Mug" } };

describe("barcode scan response shape", () => {
  it("reads the bare array the scan route returns", async () => {
    vi.mocked(adminJson).mockResolvedValueOnce([match]);
    await expect(scanBarcode("4006381333931")).resolves.toEqual([match]);
    expect(adminJson).toHaveBeenCalledWith("/inventory/scan/4006381333931");
  });

  it("treats a non-array body as no matches", () => {
    expect(toScanMatches({ matches: [match] })).toEqual([]);
    expect(toScanMatches(null)).toEqual([]);
  });
});
