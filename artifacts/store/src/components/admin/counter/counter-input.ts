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

export function parseQuantity(text: string): number | null {
  if (typeof text !== "string" || text.trim() === "") {
    return null;
  }
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    return null;
  }
  return n;
}
