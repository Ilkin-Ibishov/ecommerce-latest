import type { BarcodeScanMatch } from "@workspace/api-client-react";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";

/** `GET /inventory/scan/:barcode` answers a bare array (`BarcodeScanResult`), not `{ matches }`. */
export function toScanMatches(data: unknown): BarcodeScanMatch[] {
  return Array.isArray(data) ? (data as BarcodeScanMatch[]) : [];
}

/** Throws on 404 and other errors, like `adminJson`. */
export async function scanBarcode(code: string): Promise<BarcodeScanMatch[]> {
  return toScanMatches(await adminJson(apiUrl(`/inventory/scan/${encodeURIComponent(code)}`)));
}
