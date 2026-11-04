import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ClipboardCheck, BookmarkCheck, Plus, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StockCell } from "@/components/admin/StockCell";
import { SearchInput } from "@/components/admin/SearchInput";
import { SortableHeader } from "@/components/admin/SortableHeader";
import { CategoryFilter } from "@/components/admin/CategoryFilter";
import { CSVExportButton } from "@/components/admin/CSVExportButton";
import { TableEmptyState } from "@/components/admin/TableEmptyState";
import { CreateDepositModal } from "@/components/admin/CreateDepositModal";
import { getProxyUrl } from "@/lib/image-proxy";
import { useI18n } from "@/lib/i18n/context";
import { getTranslatedField } from "@/lib/utils";

type Filter = "all" | "out_of_stock" | "low_stock" | "healthy" | "deficit";
type SortKey = "name" | "price" | "stock" | "reserved" | "available" | "value";
type SortDir = "asc" | "desc";

interface InventoryProduct {
  id: string;
  slug: string;
  sku: string | null;
  price: number;
  stock: number;
  on_hand: number;
  reserved_quantity: number;
  available_quantity: number;
  deficit_quantity: number;
  brand: string | null;
  title: string;
  image: string | null;
  categoryIds: string[];
}

function SummaryCard({ label, value, color, sub }: {
  label: string; value: number; color: string; sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function AdminInventoryPage() {
  const { t } = useI18n();
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [createDepositOpen, setCreateDepositOpen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: prods } = await supabase
      .from("products")
      .select("id, slug, sku, price, stock, brand, product_translations(lang_code, title), product_images(url, sort_order), product_categories(category_id)")
      .order("stock", { ascending: true });

    const { data: availRows } = await (supabase as any)
      .from("product_variant_availability")
      .select("product_id, on_hand, reserved_quantity, available_quantity, deficit_quantity");

    const availMap = new Map<string, { on_hand: number; reserved_quantity: number; available_quantity: number; deficit_quantity: number }>();
    for (const row of availRows ?? []) {
      const cur = availMap.get(row.product_id) ?? { on_hand: 0, reserved_quantity: 0, available_quantity: 0, deficit_quantity: 0 };
      cur.on_hand += Number(row.on_hand ?? 0);
      cur.reserved_quantity += Number(row.reserved_quantity ?? 0);
      cur.available_quantity += Number(row.available_quantity ?? 0);
      cur.deficit_quantity += Number(row.deficit_quantity ?? 0);
      availMap.set(row.product_id, cur);
    }

    const mapped: InventoryProduct[] = (prods ?? []).map((p) => {
      const av = availMap.get(p.id);
      const onHand = av ? av.on_hand : Number(p.stock);
      const reserved = av ? av.reserved_quantity : 0;
      const available = av ? av.available_quantity : Math.max(0, onHand - reserved);
      const deficit = av ? av.deficit_quantity : Math.max(0, reserved - onHand);

      return {
        id: p.id,
        slug: p.slug,
        sku: p.sku ?? null,
        price: Number(p.price),
        stock: onHand,
        on_hand: onHand,
        reserved_quantity: reserved,
        available_quantity: available,
        deficit_quantity: deficit,
        brand: p.brand ?? null,
        title: getTranslatedField(p.product_translations, "az", "title", "Unknown"),
        image: [...(p.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]?.url ?? null,
        categoryIds: (p.product_categories ?? []).map((pc) => pc.category_id),
      };
    });

    setProducts(mapped);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Derived stats
  const outOfStock = products.filter((p) => p.available_quantity === 0).length;
  const lowStock = products.filter((p) => p.available_quantity > 0 && p.available_quantity < 10).length;
  const healthyStock = products.filter((p) => p.available_quantity >= 10).length;
  const deficitCount = products.filter((p) => p.deficit_quantity > 0).length;
  const totalValue = products.reduce((sum, p) => sum + p.price * p.on_hand, 0);

  // Client-side filtering pipeline: stock filter → search → category
  const filteredProducts = products
    .filter((p) => {
      if (filter === "out_of_stock") return p.available_quantity === 0;
      if (filter === "low_stock") return p.available_quantity > 0 && p.available_quantity < 10;
      if (filter === "healthy") return p.available_quantity >= 10;
      if (filter === "deficit") return p.deficit_quantity > 0;
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
            cmp = a.on_hand - b.on_hand;
            break;
          case "reserved":
            cmp = a.reserved_quantity - b.reserved_quantity;
            break;
          case "available":
            cmp = a.available_quantity - b.available_quantity;
            break;
          case "value":
            cmp = (a.price * a.on_hand) - (b.price * b.on_hand);
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
    { key: "all", label: t("Admin.Inventory.filterAll") },
    { key: "out_of_stock", label: t("Admin.Inventory.filterOutOfStock") },
    { key: "low_stock", label: t("Admin.Inventory.filterLowStock") },
    { key: "healthy", label: t("Admin.Inventory.filterHealthy") },
    ...(deficitCount > 0 ? [{ key: "deficit" as Filter, label: `Deficit (${deficitCount})` }] : []),
  ];

  // CSV columns configuration
  const csvColumns: { key: keyof InventoryProduct | ((row: InventoryProduct) => string | number); header: string }[] = [
    { key: "title", header: t("Admin.Inventory.colProduct") },
    { key: "sku", header: t("Admin.Inventory.colSku") },
    { key: "brand", header: t("Admin.Inventory.colBrand") },
    { key: (row) => row.categoryIds.length > 0 ? row.categoryIds.join("; ") : "", header: t("Admin.Categories.title") },
    { key: (row) => row.price.toFixed(2), header: t("Admin.Inventory.colPrice") + " (AZN)" },
    { key: "on_hand", header: "On Hand (H)" },
    { key: "reserved_quantity", header: "Reserved (R)" },
    { key: "available_quantity", header: "Available (A)" },
    { key: "deficit_quantity", header: "Deficit" },
    { key: (row) => (row.price * row.on_hand).toFixed(2), header: t("Admin.Inventory.colValue") + " (AZN)" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">{t("Admin.Inventory.title")}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/admin/reservations"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input bg-card hover:bg-muted text-xs font-semibold text-foreground transition"
          >
            <BookmarkCheck size={15} className="text-primary" />
            Deposits &amp; Holds
          </Link>
          <button
            onClick={() => setCreateDepositOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold transition shadow-sm"
          >
            <Plus size={14} /> New Deposit (&lt; 1 min)
          </button>
          <Link
            href="/admin/stocktakes"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input bg-card hover:bg-muted text-xs font-semibold text-foreground transition"
          >
            <ClipboardCheck size={15} className="text-primary" />
            Physical Stocktake
          </Link>
          {!loading && (
            <p className="text-sm text-muted-foreground ml-2">
              {t("Admin.Inventory.totalValue")} <span className="font-semibold text-foreground">{totalValue.toFixed(2)} AZN</span>
            </p>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-2">
              <div className="h-3 w-20 bg-muted animate-pulse rounded" />
              <div className="h-8 w-12 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            label={t("Admin.Inventory.outOfStock")}
            value={outOfStock}
            color={outOfStock > 0 ? "text-red-400" : "text-muted-foreground"}
            sub={outOfStock > 0 ? t("Admin.Inventory.needsRestocking") : t("Admin.Inventory.allInStock")}
          />
          <SummaryCard
            label={t("Admin.Inventory.lowStock")}
            value={lowStock}
            color={lowStock > 0 ? "text-amber-500" : "text-muted-foreground"}
            sub={t("Admin.Inventory.lessThanTen")}
          />
          <SummaryCard
            label={t("Admin.Inventory.healthyStock")}
            value={healthyStock}
            color="text-green-400"
            sub={t("Admin.Inventory.tenPlusUnits")}
          />
          <SummaryCard
            label="Promises Exceed Stock"
            value={deficitCount}
            color={deficitCount > 0 ? "text-destructive" : "text-muted-foreground"}
            sub={deficitCount > 0 ? "Count < reservations" : "No deficit"}
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
                  : key === "deficit" ? deficitCount
                  : healthyStock})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Toolbar: Search, Category Filter, CSV Export */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput
          placeholder={t("Admin.Inventory.searchPlaceholder")}
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
          <table className="w-full min-w-[850px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <SortableHeader
                  label={t("Admin.Inventory.colProduct")}
                  sortKey="name"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className="text-left"
                />
                <th className="text-left px-4 py-3 font-medium">{t("Admin.Inventory.colSku")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("Admin.Inventory.colBrand")}</th>
                <SortableHeader
                  label={t("Admin.Inventory.colPrice")}
                  sortKey="price"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
                <SortableHeader
                  label="On Hand (H)"
                  sortKey="stock"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
                <SortableHeader
                  label="Reserved (R)"
                  sortKey="reserved"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
                <SortableHeader
                  label="Available (A)"
                  sortKey="available"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
                <SortableHeader
                  label={t("Admin.Inventory.colValue")}
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
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-16 ml-auto" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-12 ml-auto" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-12 ml-auto" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-12 ml-auto" /></td>
                    <td className="px-4 py-3 text-right"><div className="h-4 bg-muted animate-pulse rounded w-16 ml-auto" /></td>
                  </tr>
                ))
              ) : sortedProducts.length === 0 ? (
                <TableEmptyState colSpan={8} message={t("Admin.Common.noResults")} />
              ) : sortedProducts.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-border/50 hover:bg-muted/20 transition ${
                    p.available_quantity === 0 ? "bg-red-500/5" : p.available_quantity < 5 ? "bg-orange-500/5" : ""
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
                      initialStock={p.on_hand}
                      onSaved={(id, newOnHand) =>
                        setProducts((prev) => prev.map((x) => x.id === id ? {
                          ...x,
                          on_hand: newOnHand,
                          stock: newOnHand,
                          available_quantity: Math.max(0, newOnHand - x.reserved_quantity),
                          deficit_quantity: Math.max(0, x.reserved_quantity - newOnHand),
                        } : x))
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {p.reserved_quantity}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className={`font-semibold ${p.available_quantity === 0 ? "text-red-500" : ""}`}>
                        {p.available_quantity}
                      </span>
                      {p.deficit_quantity > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-destructive/15 text-destructive"
                          title={`Warning: Promised reservations exceed physical stock by ${p.deficit_quantity} unit(s)`}
                        >
                          <AlertTriangle size={10} /> Deficit {p.deficit_quantity}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {(p.price * p.on_hand).toFixed(2)} AZN
                  </td>
                </tr>
              ))}
            </tbody>
            {!loading && sortedProducts.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/20">
                  <td colSpan={7} className="px-4 py-3 font-semibold text-right text-sm">
                    {filter === "all" && !search && !categoryFilter ? t("Admin.Inventory.totalInventoryValue") : t("Admin.Inventory.subtotalFiltered")}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-primary">
                    {sortedProducts.reduce((sum, p) => sum + p.price * p.on_hand, 0).toFixed(2)} AZN
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <CreateDepositModal
        open={createDepositOpen}
        onClose={() => setCreateDepositOpen(false)}
        onCreated={loadData}
      />
    </div>
  );
}
