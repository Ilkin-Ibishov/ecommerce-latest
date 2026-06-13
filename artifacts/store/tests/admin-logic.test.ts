import { describe, it, expect } from "vitest";
import { escapeCSV } from "../src/components/admin/CSVExportButton";

// ─────────────────────────────────────────────────────────────────────────────
// Pure logic mirrored from the admin pages. The page components keep this logic
// inline, so it is re-implemented here as standalone, testable functions that
// match the production behaviour exactly.
// ─────────────────────────────────────────────────────────────────────────────

// 1. CSV row generation (mirrors CSVExportButton.exportCSV)
interface CSVColumn<T> {
  key: keyof T | ((row: T) => string | number);
  header: string;
}

function generateCSV<T>(data: T[], columns: CSVColumn<T>[]): string {
  const header = columns.map((c) => escapeCSV(c.header)).join(",");
  const rows = data.map((row) =>
    columns
      .map((col) => {
        const val = typeof col.key === "function" ? col.key(row) : row[col.key];
        return escapeCSV(String(val ?? ""));
      })
      .join(",")
  );
  return [header, ...rows].join("\n");
}

// 2. Bulk price calculation (mirrors ProductsPage BulkPriceModal.handleConfirm)
function calcBulkPrice(
  currentPrice: number,
  mode: "percentage" | "fixed",
  value: number
): number {
  const newPrice = mode === "percentage" ? currentPrice * (1 - value / 100) : value;
  return Math.max(0, Math.round(newPrice * 100) / 100);
}

// 3 & 4. Inventory filter + sort (mirrors InventoryPage)
interface InvProduct {
  title: string;
  slug: string;
  brand: string | null;
  stock: number;
  price: number;
  categoryIds: string[];
}

function filterInventory(
  products: InvProduct[],
  opts: {
    stockFilter: "all" | "out_of_stock" | "low_stock" | "healthy";
    search: string;
    categoryId: string | null;
  }
): InvProduct[] {
  return products
    .filter((p) => {
      if (opts.stockFilter === "out_of_stock") return p.stock === 0;
      if (opts.stockFilter === "low_stock") return p.stock > 0 && p.stock < 10;
      if (opts.stockFilter === "healthy") return p.stock >= 10;
      return true;
    })
    .filter((p) => {
      if (!opts.search) return true;
      const q = opts.search.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.brand?.toLowerCase().includes(q) ?? false)
      );
    })
    .filter((p) => {
      if (!opts.categoryId) return true;
      return p.categoryIds.includes(opts.categoryId);
    });
}

function sortInventory(
  products: InvProduct[],
  key: "name" | "price" | "stock" | "value",
  dir: "asc" | "desc"
): InvProduct[] {
  return [...products].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "name":
        cmp = a.title.localeCompare(b.title);
        break;
      case "price":
        cmp = a.price - b.price;
        break;
      case "stock":
        cmp = a.stock - b.stock;
        break;
      case "value":
        cmp = a.price * a.stock - b.price * b.stock;
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────
interface Item {
  name: string;
  price: number;
  stock: number;
}

const sampleColumns: CSVColumn<Item>[] = [
  { key: "name", header: "Name" },
  { key: "price", header: "Price" },
  { key: "stock", header: "Stock" },
  { key: (row) => row.price * row.stock, header: "Value" },
];

function makeProduct(overrides: Partial<InvProduct> = {}): InvProduct {
  return {
    title: "Widget",
    slug: "widget",
    brand: "Acme",
    stock: 5,
    price: 10,
    categoryIds: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CSV row generation
// ─────────────────────────────────────────────────────────────────────────────
describe("escapeCSV", () => {
  it("leaves plain values untouched", () => {
    expect(escapeCSV("hello")).toBe("hello");
  });

  it("quotes values containing a comma", () => {
    expect(escapeCSV("a,b")).toBe('"a,b"');
  });

  it("quotes and doubles embedded double quotes", () => {
    expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes values containing a newline", () => {
    expect(escapeCSV("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("generateCSV", () => {
  it("produces a header row matching the column headers", () => {
    const csv = generateCSV<Item>([], sampleColumns);
    expect(csv).toBe("Name,Price,Stock,Value");
  });

  it("produces N data rows for N input items", () => {
    const data: Item[] = [
      { name: "A", price: 1, stock: 2 },
      { name: "B", price: 3, stock: 4 },
      { name: "C", price: 5, stock: 6 },
    ];
    const lines = generateCSV(data, sampleColumns).split("\n");
    // 1 header + 3 data rows
    expect(lines).toHaveLength(4);
  });

  it("computes function-accessor columns (value = price * stock)", () => {
    const data: Item[] = [{ name: "A", price: 7, stock: 3 }];
    const lines = generateCSV(data, sampleColumns).split("\n");
    expect(lines[1]).toBe("A,7,3,21");
  });

  it("quotes values that contain commas in the output", () => {
    const data: Item[] = [{ name: "Doe, John", price: 1, stock: 1 }];
    const lines = generateCSV(data, sampleColumns).split("\n");
    expect(lines[1]).toBe('"Doe, John",1,1,1');
  });

  it("produces just the header row for empty data", () => {
    const csv = generateCSV<Item>([], sampleColumns);
    expect(csv.split("\n")).toHaveLength(1);
    expect(csv).toBe("Name,Price,Stock,Value");
  });

  it("renders null/undefined cell values as empty strings", () => {
    interface Row {
      a: string | null;
      b: string | undefined;
    }
    const cols: CSVColumn<Row>[] = [
      { key: "a", header: "A" },
      { key: "b", header: "B" },
    ];
    const data: Row[] = [{ a: null, b: undefined }];
    const lines = generateCSV(data, cols).split("\n");
    expect(lines[1]).toBe(",");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Bulk price calculation
// ─────────────────────────────────────────────────────────────────────────────
describe("calcBulkPrice", () => {
  it("applies a 20% discount: 100 → 80", () => {
    expect(calcBulkPrice(100, "percentage", 20)).toBe(80);
  });

  it("applies a 10% discount: 50 → 45", () => {
    expect(calcBulkPrice(50, "percentage", 10)).toBe(45);
  });

  it("sets a fixed price regardless of current price", () => {
    expect(calcBulkPrice(250, "fixed", 99.99)).toBe(99.99);
    expect(calcBulkPrice(1, "fixed", 99.99)).toBe(99.99);
  });

  it("clamps discounts over 100% to 0 (never negative)", () => {
    expect(calcBulkPrice(100, "percentage", 150)).toBe(0);
    expect(calcBulkPrice(100, "percentage", 100)).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    // 33.333 * (1 - 10/100) = 29.9997 → 30.0
    expect(calcBulkPrice(33.333, "percentage", 10)).toBe(30);
    // 19.99 * (1 - 15/100) = 16.9915 → 16.99
    expect(calcBulkPrice(19.99, "percentage", 15)).toBe(16.99);
  });

  it("keeps price unchanged for a 0% discount", () => {
    expect(calcBulkPrice(42.5, "percentage", 0)).toBe(42.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Inventory filter pipeline
// ─────────────────────────────────────────────────────────────────────────────
describe("filterInventory", () => {
  const products: InvProduct[] = [
    makeProduct({ title: "Out", slug: "out", brand: "Alpha", stock: 0 }),
    makeProduct({ title: "Low", slug: "low", brand: "Beta", stock: 5 }),
    makeProduct({ title: "Mid", slug: "mid", brand: "Gamma", stock: 9 }),
    makeProduct({ title: "Healthy", slug: "healthy", brand: "Delta", stock: 10 }),
    makeProduct({ title: "Plenty", slug: "plenty", brand: "Epsilon", stock: 100 }),
  ];

  const baseOpts = { stockFilter: "all" as const, search: "", categoryId: null };

  it("returns only out-of-stock (stock === 0) items", () => {
    const result = filterInventory(products, { ...baseOpts, stockFilter: "out_of_stock" });
    expect(result.map((p) => p.title)).toEqual(["Out"]);
  });

  it("returns only low-stock (stock 1-9) items", () => {
    const result = filterInventory(products, { ...baseOpts, stockFilter: "low_stock" });
    expect(result.map((p) => p.title)).toEqual(["Low", "Mid"]);
  });

  it("returns only healthy (stock >= 10) items", () => {
    const result = filterInventory(products, { ...baseOpts, stockFilter: "healthy" });
    expect(result.map((p) => p.title)).toEqual(["Healthy", "Plenty"]);
  });

  it("returns everything for the 'all' filter", () => {
    const result = filterInventory(products, baseOpts);
    expect(result).toHaveLength(products.length);
  });

  it("matches search against the title (case-insensitive)", () => {
    const result = filterInventory(products, { ...baseOpts, search: "HEALTHY" });
    expect(result.map((p) => p.title)).toEqual(["Healthy"]);
  });

  it("matches search against the slug (case-insensitive)", () => {
    const result = filterInventory(products, { ...baseOpts, search: "PLENTY" });
    expect(result.map((p) => p.slug)).toEqual(["plenty"]);
  });

  it("matches search against the brand (case-insensitive)", () => {
    const result = filterInventory(products, { ...baseOpts, search: "gamma" });
    expect(result.map((p) => p.brand)).toEqual(["Gamma"]);
  });

  it("treats a null brand as a non-match instead of throwing", () => {
    const withNullBrand = [makeProduct({ title: "NoBrand", brand: null })];
    const result = filterInventory(withNullBrand, { ...baseOpts, search: "acme" });
    expect(result).toHaveLength(0);
  });

  it("filters by category id", () => {
    const catProducts = [
      makeProduct({ title: "InCat", categoryIds: ["c1", "c2"] }),
      makeProduct({ title: "OtherCat", categoryIds: ["c3"] }),
      makeProduct({ title: "NoCat", categoryIds: [] }),
    ];
    const result = filterInventory(catProducts, { ...baseOpts, categoryId: "c1" });
    expect(result.map((p) => p.title)).toEqual(["InCat"]);
  });

  it("applies stock, search, and category filters together as AND", () => {
    const catProducts = [
      makeProduct({ title: "Match", slug: "match", brand: "Acme", stock: 10, categoryIds: ["c1"] }),
      // fails the stock filter
      makeProduct({ title: "LowMatch", slug: "match", brand: "Acme", stock: 2, categoryIds: ["c1"] }),
      // fails the search filter
      makeProduct({ title: "Other", slug: "other", brand: "Acme", stock: 10, categoryIds: ["c1"] }),
      // fails the category filter
      makeProduct({ title: "Match", slug: "match", brand: "Acme", stock: 10, categoryIds: ["c9"] }),
    ];
    const result = filterInventory(catProducts, {
      stockFilter: "healthy",
      search: "match",
      categoryId: "c1",
    });
    expect(result.map((p) => p.title)).toEqual(["Match"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Inventory sort
// ─────────────────────────────────────────────────────────────────────────────
describe("sortInventory", () => {
  const products: InvProduct[] = [
    makeProduct({ title: "Banana", price: 30, stock: 2 }), // value 60
    makeProduct({ title: "apple", price: 10, stock: 10 }), // value 100
    makeProduct({ title: "Cherry", price: 20, stock: 1 }), // value 20
  ];

  it("sorts by price ascending", () => {
    const result = sortInventory(products, "price", "asc");
    expect(result.map((p) => p.price)).toEqual([10, 20, 30]);
  });

  it("sorts by price descending", () => {
    const result = sortInventory(products, "price", "desc");
    expect(result.map((p) => p.price)).toEqual([30, 20, 10]);
  });

  it("sorts by name using localeCompare", () => {
    const result = sortInventory(products, "name", "asc");
    expect(result.map((p) => p.title)).toEqual(["apple", "Banana", "Cherry"]);
  });

  it("sorts by value (price * stock)", () => {
    const result = sortInventory(products, "value", "asc");
    expect(result.map((p) => p.price * p.stock)).toEqual([20, 60, 100]);
  });

  it("sorts by stock", () => {
    const ascending = sortInventory(products, "stock", "asc");
    expect(ascending.map((p) => p.stock)).toEqual([1, 2, 10]);
    const descending = sortInventory(products, "stock", "desc");
    expect(descending.map((p) => p.stock)).toEqual([10, 2, 1]);
  });

  it("does not mutate the original array", () => {
    const original = [...products];
    sortInventory(products, "price", "desc");
    expect(products).toEqual(original);
  });
});
