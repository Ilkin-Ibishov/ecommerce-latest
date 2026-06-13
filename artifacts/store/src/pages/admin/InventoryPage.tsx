import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { StockCell } from "@/components/admin/StockCell";
import { SearchInput } from "@/components/admin/SearchInput";
import { SortableHeader } from "@/components/admin/SortableHeader";
import { CategoryFilter } from "@/components/admin/CategoryFilter";
import { CSVExportButton } from "@/components/admin/CSVExportButton";
import { getProxyUrl } from "@/lib/image-proxy";

type Filter = "all" | "out_of_stock" | "low_stock" | "healthy";
type SortKey = "name" | "price" | "stock" | "value";
type SortDir = "asc" | "desc";

interface InventoryProduct {
  id: string;
  slug: string;
  sku: string | null;
  price: number;
  stock: number;
  brand: string | null;
  title: string;
  image: string | null;
  categoryIds: string[];
}

function SummaryCard({ label, value, color, sub }: {
  label: string; value: number; color: string; sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function AdminInventoryPage() {
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await (supabase as any)
        .from("products")
        .select("id, slug, sku, price, stock, brand, product_translations(lang_code, title), product_images(url, sort_order), product_categories(category_id)")
        .order("stock", { ascending: true }); // out-of-stock first

      const mapped: InventoryProduct[] = (data ?? []).map((p: any) => ({
        id: p.id,
        slug: p.slug,
        sku: p.sku ?? null,
        price: Number(p.price),
        stock: p.stock,
        brand: p.brand ?? null,
        title: (p.product_translations as any[])?.find((t: any) => t.lang_code === "az")?.title
          ?? (p.product_translations as any[])?.[0]?.title ?? "Unknown",
        image: [...(p.product_images ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order)[0]?.url ?? null,
        categoryIds: (p.product_categories ?? []).map((pc: any) => pc.category_id),
      }));

      setProducts(mapped);
      setLoading(false);
    })();
  }, []);

  // Derived stats
  const outOfStock = products.filter((p) => p.stock === 0).length;
  const lowStock = products.filter((p) => p.stock > 0 && p.stock < 10).length;
  const healthyStock = products.filter((p) => p.stock >= 10).length;
  const totalValue = products.reduce((sum, p) => sum + p.price * p.stock, 0);

  // Client-side filtering pipeline: stock filter → search → category
  const filteredProducts = products
    .filter((p) => {
      if (filter === "out_of_stock") return p.stock === 0;
      if (filter === "low_stock") return p.stock > 0 && p.stock < 10;
      if (filter === "healthy") return p.stock >= 10;
      return true;
    })
    .filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.brand?.toLowerCase().includes(q) ?? false)
      );
    })
    .filter((p) => {
      if (!categoryFilter) return true;
      return p.categoryIds.includes(categoryFilter);
    });

  // Client-side sorting
  const sortedProducts = sortKey
    ? [...filteredProducts].sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
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
            cmp = (a.price * a.stock) - (b.price * b.stock);
            break;
        }
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filteredProducts;

  const handleSort = (key: string, dir: "asc" | "desc") => {
    setSortKey(key as SortKey);
    setSortDir(dir);
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "out_of_stock", label: "Out of Stock" },
    { key: "low_stock", label: "Low Stock (<10)" },
    { key: "healthy", label: "Healthy" },
  ];

  // CSV columns configuration
  const csvColumns: { key: keyof InventoryProduct | ((row: InventoryProduct) => string | number); header: string }[] = [
    { key: "title", header: "Product Name" },
    { key: "sku", header: "SKU" },
    { key: "brand", header: "Brand" },
    { key: (row) => row.categoryIds.length > 0 ? row.categoryIds.join("; ") : "", header: "Category" },
    { key: (row) => row.price.toFixed(2), header: "Price (AZN)" },
    { key: "stock", header: "Stock" },
    { key: (row) => (row.price * row.stock).toFixed(2), header: "Value (AZN)" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Inventory</h1>
        {!loading && (
          <p className="text-sm text-muted-foreground">
            Total value: <span className="font-semibold text-foreground">{totalValue.toFixed(2)} AZN</span>
          </p>
        )}
      </div>

      {/* Summary cards */}
      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-2">
              <div className="h-3 w-20 bg-muted animate-pulse rounded" />
              <div className="h-8 w-12 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <SummaryCard
            label="Out of Stock"
            value={outOfStock}
            color={outOfStock > 0 ? "text-red-400" : "text-muted-foreground"}
            sub={outOfStock > 0 ? "Needs immediate restocking" : "All in stock ✓"}
          />
          <SummaryCard
            label="Low Stock"
            value={lowStock}
            color={lowStock > 0 ? "text-amber-500" : "text-muted-foreground"}
            sub="Less than 10 units"
          />
          <SummaryCard
            label="Healthy Stock"
            value={healthyStock}
            color="text-green-400"
            sub="10+ units available"
          />
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === key
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {label}
            {!loading && (
              <span className="ml-1.5 opacity-70">
                ({key === "all" ? products.length
                  : key === "out_of_stock" ? outOfStock
                  : key === "low_stock" ? lowStock
                  : healthyStock})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Toolbar: Search, Category Filter, CSV Export */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput
          placeholder="Search by name, slug, or brand..."
          value={search}
          onChange={setSearch}
        />
        <CategoryFilter
          value={categoryFilter}
          onFilter={setCategoryFilter}
        />
        <div className="ml-auto">
          <CSVExportButton
            data={sortedProducts}
            columns={csvColumns}
            filename="inventory-export"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <SortableHeader
                  label="Product"
                  sortKey="name"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className="text-left"
                />
                <th className="text-left px-4 py-3 font-medium">SKU</th>
                <th className="text-left px-4 py-3 font-medium">Brand</th>
                <SortableHeader
                  label="Price"
                  sortKey="price"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
                <SortableHeader
                  label="Stock"
                  sortKey="stock"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
                <SortableHeader
                  label="Value"
                  sortKey="value"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-4 py-3"><div className="h-4 bg-muted animate-pulse rounded w-48" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-muted animate-pulse rounded w-16" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-muted animate-pulse rounded w-16" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-20 ml-auto" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-12 ml-auto" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-20 ml-auto" /></td>
                  </tr>
                ))
              ) : sortedProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No products match this filter.
                  </td>
                </tr>
              ) : sortedProducts.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-border/50 hover:bg-muted/20 transition ${
                    p.stock === 0 ? "bg-red-500/5" : p.stock < 5 ? "bg-orange-500/5" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-muted overflow-hidden shrink-0">
                        {p.image
                          ? <img src={getProxyUrl(p.image, "thumbnail")} alt={p.title} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = p.image!; }} />
                          : <div className="w-full h-full bg-muted" />}
                      </div>
                      <Link
                        href={`/admin/products/${p.id}/edit`}
                        className="font-medium hover:text-primary transition line-clamp-1 max-w-[220px]"
                      >
                        {p.title}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs font-mono">{p.sku ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{p.brand ?? "—"}</td>
                  <td className="px-4 py-3 text-right">{p.price.toFixed(2)} AZN</td>
                  <td className="px-4 py-3 text-right">
                    <StockCell
                      productId={p.id}
                      initialStock={p.stock}
                      onSaved={(id, stock) =>
                        setProducts((prev) => prev.map((x) => x.id === id ? { ...x, stock } : x))
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {(p.price * p.stock).toFixed(2)} AZN
                  </td>
                </tr>
              ))}
            </tbody>
            {!loading && sortedProducts.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/20">
                  <td colSpan={5} className="px-4 py-3 font-semibold text-right text-sm">
                    {filter === "all" && !search && !categoryFilter ? "Total Inventory Value:" : `Subtotal (filtered):`}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-primary">
                    {sortedProducts.reduce((sum, p) => sum + p.price * p.stock, 0).toFixed(2)} AZN
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
