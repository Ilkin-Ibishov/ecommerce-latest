export function computeChange(
  tendered: string | number,
  total: number,
): { sufficient: boolean; change: number } {
  if (typeof tendered === "string" && tendered.trim() === "") {
    return { sufficient: false, change: 0 };
  }
  const t = Number(tendered);
  if (!Number.isFinite(t) || !Number.isFinite(total)) {
    return { sufficient: false, change: 0 };
  }
  const tenderedQ = Math.round(t * 100);
  const totalQ = Math.round(total * 100);
  const sufficient = tenderedQ >= totalQ;
  const change = sufficient ? (tenderedQ - totalQ) / 100 : 0;
  return { sufficient, change };
}

// Largest quantity on one till line, whichever way it is entered (typed, +, scanned).
export const MAX_QUANTITY = 9999;

export function parseQuantity(text: string): number | null {
  if (typeof text !== "string" || text.trim() === "") {
    return null;
  }
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUANTITY) {
    return null;
  }
  return n;
}

// What a typed quantity commits to: the parsed number, or the line's current quantity when the
// text is not a whole number from 1 to MAX_QUANTITY (rejected, so the till can say why).
export function resolveQuantityInput(text: string, current: number): { quantity: number; rejected: boolean } {
  const q = parseQuantity(text);
  return q === null ? { quantity: current, rejected: true } : { quantity: q, rejected: false };
}

// A scan adds a pack to the line; the line stops at MAX_QUANTITY.
export function addQuantity(current: number, added: number): number {
  return Math.min(current + added, MAX_QUANTITY);
}
