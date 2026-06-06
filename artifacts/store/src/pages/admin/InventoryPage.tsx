import { useEffect, useState } from "react";
import { Link } from "wouter";
import { createClient } from "@/lib/supabase/client";
import { StockCell } from "@/components/admin/StockCell";

type Filter = "all" | "out_of_stock" | "low_stock" | "healthy";

interface InventoryProduct {
  id: string;
  slug: string;
  price: number;
  stock: number;
  brand: string | null;
  title: string;
  image: string | null;
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

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data } = await (supabase as any)
        .from("products")
        .select("id, slug, price, stock, brand, product_translations(lang_code, title), product_images(url, sort_order)")
        .order("stock", { ascending: true }); // out-of-stock first

      const mapped: InventoryProduct[] = (data ?? []).map((p: any) => ({
        id: p.id,
        slug: p.slug,
        price: Number(p.price),
        stock: p.stock,
        brand: p.brand ?? null,
        title: (p.product_translations as any[])?.find((t: any) => t.lang_code === "az")?.title
          ?? (p.product_translations as any[])?.[0]?.title ?? "Unknown",
        image: [...(p.product_images ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order)[0]?.url ?? null,
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

  // Client-side filter (all data loaded — 152 products is fine in memory)
  const filteredProducts = products.filter((p) => {
    if (filter === "out_of_stock") return p.stock === 0;
    if (filter === "low_stock") return p.stock > 0 && p.stock < 10;
    if (filter === "healthy") return p.stock >= 10;
    return true;
  });

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "out_of_stock", label: "Out of Stock" },
    { key: "low_stock", label: "Low Stock (<10)" },
    { key: "healthy", label: "Healthy" },
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

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-3 font-medium">Product</th>
                <th className="text-left px-4 py-3 font-medium">Brand</th>
                <th className="text-right px-4 py-3 font-medium">Price</th>
                <th className="text-right px-4 py-3 font-medium">Stock</th>
                <th className="text-right px-4 py-3 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-4 py-3"><div className="h-4 bg-muted animate-pulse rounded w-48" /></td>
                    <td className="px-4 py-3"><div className="h-4 bg-muted animate-pulse rounded w-16" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-20 ml-auto" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-12 ml-auto" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-20 ml-auto" /></td>
                  </tr>
                ))
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    No products match this filter.
                  </td>
                </tr>
              ) : filteredProducts.map((p) => (
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
                          ? <img src={p.image} alt={p.title} className="w-full h-full object-cover" />
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
            {!loading && filteredProducts.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/20">
                  <td colSpan={4} className="px-4 py-3 font-semibold text-right text-sm">
                    {filter === "all" ? "Total Inventory Value:" : `Subtotal (${FILTERS.find((f) => f.key === filter)?.label}):`}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-primary">
                    {filteredProducts.reduce((sum, p) => sum + p.price * p.stock, 0).toFixed(2)} AZN
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
