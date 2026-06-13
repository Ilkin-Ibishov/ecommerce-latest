import { useEffect, useState, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Plus, Pencil, Trash2, Copy, X, DollarSign } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { StockCell } from "@/components/admin/StockCell";
import { getProxyUrl } from "@/lib/image-proxy";
import { SearchInput } from "@/components/admin/SearchInput";
import { SortableHeader } from "@/components/admin/SortableHeader";
import { CategoryFilter } from "@/components/admin/CategoryFilter";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { PriceCell } from "@/components/admin/PriceCell";

const PAGE_SIZE = 25;
type FlagFilter = "" | "featured" | "sale" | "deal" | "low_stock" | "out_of_stock";

// ── Bulk Price Update Modal ────────────────────────────────────────────────
function BulkPriceModal({ open, onClose, selectedProducts, onComplete }: {
  open: boolean;
  onClose: () => void;
  selectedProducts: { id: string; price: number }[];
  onComplete: () => void;
}) {
  const [mode, setMode] = useState<"percentage" | "fixed">("percentage");
  const [value, setValue] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  if (!open) return null;

  const handleConfirm = async () => {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) return;
    setProcessing(true);
    setProgress(0);

    for (let i = 0; i < selectedProducts.length; i++) {
      const product = selectedProducts[i];
      const newPrice = mode === "percentage"
        ? product.price * (1 - numValue / 100)
        : numValue;
      await adminFetch(apiUrl(`/admin/products/${product.id}`), {
        method: "PATCH",
        body: JSON.stringify({ price: Math.max(0, Math.round(newPrice * 100) / 100) }),
      });
      setProgress(i + 1);
    }

    setProcessing(false);
    setValue("");
    onComplete();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={!processing ? onClose : undefined} />
      <div className="relative bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 className="font-semibold text-lg">Bulk Price Update</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Update price for {selectedProducts.length} selected product{selectedProducts.length !== 1 ? "s" : ""}
        </p>

        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="priceMode" checked={mode === "percentage"} onChange={() => setMode("percentage")} />
            Percentage discount
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="priceMode" checked={mode === "fixed"} onChange={() => setMode("fixed")} />
            Set fixed price
          </label>

          <input
            type="number" min={0} step="0.01" value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={mode === "percentage" ? "Discount %" : "New price (AZN)"}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={processing}
          />

          {processing && (
            <div className="space-y-1">
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div className="bg-primary h-full transition-all" style={{ width: `${(progress / selectedProducts.length) * 100}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{progress} / {selectedProducts.length} updated</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} disabled={processing}
            className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={processing || !value}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50">
            {processing ? "Updating…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk action toolbar ────────────────────────────────────────────────────
function BulkBar({ count, onFlag, onDelete, onBulkPrice, onClear }: {
  count: number;
  onFlag: (field: string, value: boolean) => void;
  onDelete: () => void;
  onBulkPrice: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  const Btn = ({ label, onClick, destructive, icon }: { label: string; onClick: () => void; destructive?: boolean; icon?: React.ReactNode }) => (
    <button onClick={onClick}
      className={`px-3 py-1 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5 ${
        destructive ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      }`}
    >
      {icon}{label}
    </button>
  );
  return (
    <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-xl text-sm">
      <span className="font-medium text-primary">{count} selected</span>
      <div className="flex gap-1.5 ml-2 flex-wrap">
        <Btn label="Set Featured" onClick={() => onFlag("is_featured", true)} />
        <Btn label="Unset Featured" onClick={() => onFlag("is_featured", false)} />
        <Btn label="Set On Sale" onClick={() => onFlag("is_on_sale", true)} />
        <Btn label="Unset On Sale" onClick={() => onFlag("is_on_sale", false)} />
        <Btn label="Bulk Price" onClick={onBulkPrice} icon={<DollarSign size={12} />} />
        <Btn label="Delete" onClick={onDelete} destructive />
      </div>
      <button onClick={onClear} className="ml-auto text-muted-foreground hover:text-foreground"><X size={14} /></button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function AdminProductsPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const searchQuery = params.get("q") ?? "";
  const flagFilter = (params.get("flag") ?? "") as FlagFilter;
  const sortField = params.get("sort") ?? "sort_order";
  const sortDir = (params.get("dir") ?? "asc") as "asc" | "desc";
  const categoryFilter = params.get("cat") ?? "";
  const offset = (page - 1) * PAGE_SIZE;

  const [products, setProducts] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);

  // ConfirmDialog state (task 5.5)
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({
    open: false, title: "", message: "", onConfirm: () => {},
  });

  // Update URL helper
  const updateUrl = useCallback((overrides: Record<string, string>) => {
    const p = new URLSearchParams();
    const current: Record<string, string> = {
      q: searchQuery,
      flag: flagFilter,
      sort: sortField,
      dir: sortDir,
      cat: categoryFilter,
      page: String(page),
    };
    const merged = { ...current, ...overrides };
    // Remove defaults/empty
    if (merged.page === "1") delete merged.page;
    if (!merged.q) delete merged.q;
    if (!merged.flag) delete merged.flag;
    if (merged.sort === "sort_order" && merged.dir === "asc") { delete merged.sort; delete merged.dir; }
    if (!merged.cat) delete merged.cat;
    Object.entries(merged).forEach(([k, v]) => { if (v) p.set(k, v); });
    const qs = p.toString();
    navigate(`/admin/products${qs ? `?${qs}` : ""}`, { replace: true });
  }, [searchQuery, flagFilter, sortField, sortDir, categoryFilter, page, navigate]);

  // Search change handler (from SearchInput debounce)
  const handleSearchChange = useCallback((val: string) => {
    updateUrl({ q: val, page: "1" });
  }, [updateUrl]);

  // Sort change handler
  const handleSort = useCallback((key: string, dir: "asc" | "desc") => {
    updateUrl({ sort: key, dir, page: "1" });
  }, [updateUrl]);

  // Category filter change
  const handleCategoryFilter = useCallback((catId: string | null) => {
    updateUrl({ cat: catId ?? "", page: "1" });
  }, [updateUrl]);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // Build select string - include sku and attempt product_categories join
    let selectStr = "id, slug, sku, price, stock, is_featured, is_on_sale, is_deal_of_day, brand, sort_order, product_images(url, sort_order), product_translations(lang_code, title), product_categories(category_id)";

    let query = (supabase as any)
      .from("products")
      .select(selectStr, { count: "exact" });

    // Apply sorting: server-side for price, stock, sort_order
    if (sortField === "price" || sortField === "stock" || sortField === "sort_order") {
      query = query.order(sortField, { ascending: sortDir === "asc" });
    } else {
      // For "name" sort, we still need some server order, sort by sort_order, then sort client-side after fetch
      query = query.order("sort_order", { ascending: true });
    }

    query = query.range(offset, offset + PAGE_SIZE - 1);

    // Full-text search on search_text column (task 5.1)
    if (searchQuery.trim()) query = query.ilike("search_text", `%${searchQuery.trim()}%`);

    // Flag filters
    if (flagFilter === "featured") query = query.eq("is_featured", true);
    else if (flagFilter === "sale") query = query.eq("is_on_sale", true);
    else if (flagFilter === "deal") query = query.eq("is_deal_of_day", true);
    else if (flagFilter === "low_stock") query = query.gt("stock", 0).lt("stock", 10);
    else if (flagFilter === "out_of_stock") query = query.eq("stock", 0);

    const { data, count: total, error } = await query;

    let results = data ?? [];

    // If product_categories join failed, strip that field gracefully
    if (error && error.message?.includes("product_categories")) {
      // Retry without the join
      const fallbackQuery = (supabase as any)
        .from("products")
        .select("id, slug, sku, price, stock, is_featured, is_on_sale, is_deal_of_day, brand, sort_order, product_images(url, sort_order), product_translations(lang_code, title)", { count: "exact" })
        .order(sortField === "price" || sortField === "stock" || sortField === "sort_order" ? sortField : "sort_order", { ascending: sortDir === "asc" })
        .range(offset, offset + PAGE_SIZE - 1);
      if (searchQuery.trim()) fallbackQuery.ilike("search_text", `%${searchQuery.trim()}%`);
      if (flagFilter === "featured") fallbackQuery.eq("is_featured", true);
      else if (flagFilter === "sale") fallbackQuery.eq("is_on_sale", true);
      else if (flagFilter === "deal") fallbackQuery.eq("is_deal_of_day", true);
      else if (flagFilter === "low_stock") fallbackQuery.gt("stock", 0).lt("stock", 10);
      else if (flagFilter === "out_of_stock") fallbackQuery.eq("stock", 0);
      const fallback = await fallbackQuery;
      results = fallback.data ?? [];
      setCount(fallback.count ?? 0);
    } else {
      setCount(total ?? 0);
    }

    // Client-side category filter if needed
    if (categoryFilter && results.length > 0) {
      results = results.filter((p: any) =>
        p.product_categories?.some((pc: any) => pc.category_id === categoryFilter)
      );
    }

    // Client-side sort for "name" column (title comes from translations join)
    if (sortField === "name") {
      results = [...results].sort((a: any, b: any) => {
        const aTitle = a.product_translations?.find((t: any) => t.lang_code === "az")?.title ?? "";
        const bTitle = b.product_translations?.find((t: any) => t.lang_code === "az")?.title ?? "";
        const cmp = aTitle.localeCompare(bTitle);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    setProducts(results);
    setSelected(new Set());
    setLoading(false);
  }, [page, searchQuery, flagFilter, sortField, sortDir, categoryFilter]);

  useEffect(() => { load(); }, [load]);

  // Selection helpers
  const allSelected = products.length > 0 && selected.size === products.length;
  const toggleSelect = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));

  // Bulk actions
  const handleBulkFlag = async (field: string, value: boolean) => {
    const ids = [...selected];
    await adminFetch(apiUrl("/admin/products/bulk-flag"), {
      method: "PATCH",
      body: JSON.stringify({ ids, field, value }),
    });
    setProducts((prev) => prev.map((p) => selected.has(p.id) ? { ...p, [field]: value } : p));
    setSelected(new Set());
  };

  const handleBulkDelete = () => {
    const ids = [...selected];
    setConfirmState({
      open: true,
      title: "Delete Products",
      message: `Delete ${ids.length} product${ids.length !== 1 ? "s" : ""}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }));
        await adminFetch(apiUrl("/admin/products/bulk"), {
          method: "DELETE",
          body: JSON.stringify({ ids }),
        });
        setProducts((prev) => prev.filter((p) => !selected.has(p.id)));
        setCount((c) => c - ids.length);
        setSelected(new Set());
      },
    });
  };

  const handleDelete = (id: string) => {
    setConfirmState({
      open: true,
      title: "Delete Product",
      message: "Delete this product? This cannot be undone.",
      onConfirm: async () => {
        setConfirmState((s) => ({ ...s, open: false }));
        await adminFetch(apiUrl(`/admin/products/${id}`), { method: "DELETE" });
        setProducts((prev) => prev.filter((p) => p.id !== id));
        setCount((c) => c - 1);
      },
    });
  };

  const handleDuplicate = async (id: string) => {
    const res = await adminFetch(apiUrl(`/admin/products/${id}/duplicate`), { method: "POST" });
    const data = await res.json();
    if (data.id) navigate(`/admin/products/${data.id}/edit`);
  };

  const setFlag = (flag: FlagFilter) => {
    updateUrl({ flag, page: "1" });
  };

  const buildPageHref = (p: number) => {
    const ps = new URLSearchParams();
    if (p > 1) ps.set("page", String(p));
    if (searchQuery) ps.set("q", searchQuery);
    if (flagFilter) ps.set("flag", flagFilter);
    if (sortField !== "sort_order" || sortDir !== "asc") { ps.set("sort", sortField); ps.set("dir", sortDir); }
    if (categoryFilter) ps.set("cat", categoryFilter);
    return `/admin/products${ps.toString() ? `?${ps.toString()}` : ""}`;
  };

  const totalPages = Math.ceil(count / PAGE_SIZE);

  // Column count for empty states
  const colSpan = 9;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Products</h1>
        <Link href="/admin/products/new" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition">
          <Plus size={16} /> New Product
        </Link>
      </div>

      {/* Search + filter bar (task 5.1: SearchInput, task 5.3: CategoryFilter) */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <SearchInput
          placeholder="Search products…"
          value={searchQuery}
          onChange={handleSearchChange}
          debounceMs={350}
        />

        <select value={flagFilter} onChange={(e) => setFlag(e.target.value as FlagFilter)}
          className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none">
          <option value="">All products</option>
          <option value="featured">Featured only</option>
          <option value="sale">On sale only</option>
          <option value="deal">Deal of day only</option>
          <option value="low_stock">Low stock (&lt;10)</option>
          <option value="out_of_stock">Out of stock</option>
        </select>

        <CategoryFilter value={categoryFilter || null} onFilter={handleCategoryFilter} />

        <span className="text-sm text-muted-foreground sm:ml-auto">
          {count} product{count !== 1 ? "s" : ""}{searchQuery && ` matching "${searchQuery}"`}
        </span>
      </div>

      {/* Bulk action bar (task 5.4: added onBulkPrice) */}
      <BulkBar
        count={selected.size}
        onFlag={handleBulkFlag}
        onDelete={handleBulkDelete}
        onBulkPrice={() => setBulkPriceOpen(true)}
        onClear={() => setSelected(new Set())}
      />

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 cursor-pointer" />
                </th>
                {/* Task 5.2: SortableHeader for Product (name) */}
                <SortableHeader label="Product" sortKey="name" currentSort={sortField} currentDir={sortDir} onSort={handleSort} className="text-left" />
                <th className="text-left px-4 py-3 font-medium">SKU</th>
                <th className="text-left px-4 py-3 font-medium">Brand</th>
                {/* Task 5.2: SortableHeader for Price */}
                <SortableHeader label="Price" sortKey="price" currentSort={sortField} currentDir={sortDir} onSort={handleSort} className="text-right" />
                {/* Task 5.2: SortableHeader for Stock */}
                <SortableHeader label="Stock" sortKey="stock" currentSort={sortField} currentDir={sortDir} onSort={handleSort} className="text-right" />
                <th className="text-left px-4 py-3 font-medium">Flags</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={colSpan} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={colSpan} className="px-4 py-12 text-center text-muted-foreground">
                  {searchQuery || flagFilter || categoryFilter
                    ? "No products match the current filters."
                    : <span>No products yet. <Link href="/admin/products/new" className="text-primary hover:underline">Add the first one.</Link></span>
                  }
                </td></tr>
              ) : products.map((p: any) => {
                const sortedImgs = [...(p.product_images ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
                const img = sortedImgs[0]?.url ?? null;
                const title = p.product_translations?.find((t: any) => t.lang_code === "az")?.title
                  ?? p.product_translations?.[0]?.title ?? "Untitled";
                return (
                  <tr key={p.id} className={`border-b border-border/50 hover:bg-muted/20 transition ${selected.has(p.id) ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="w-4 h-4 cursor-pointer" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0">
                          {img ? <img src={getProxyUrl(img, "thumbnail")} alt={title} className="object-cover w-full h-full" onError={(e) => { (e.currentTarget as HTMLImageElement).src = img; }} /> : <div className="w-full h-full bg-muted" />}
                        </div>
                        <span className="font-medium line-clamp-1 max-w-[180px]">{title}</span>
                      </div>
                    </td>
                    {/* Task 5.3: SKU column */}
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.sku ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{p.brand ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <PriceCell
                        productId={p.id}
                        initialPrice={Number(p.price)}
                        onSaved={(id, price) => setProducts((prev) => prev.map((x) => x.id === id ? { ...x, price } : x))}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StockCell
                        productId={p.id}
                        initialStock={p.stock}
                        onSaved={(id, stock) => setProducts((prev) => prev.map((x) => x.id === id ? { ...x, stock } : x))}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {p.is_featured && <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">Featured</span>}
                        {p.is_on_sale && <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Sale</span>}
                        {p.is_deal_of_day && <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">Deal</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => handleDuplicate(p.id)} title="Duplicate"
                          className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition">
                          <Copy size={13} />
                        </button>
                        <Link href={`/admin/products/${p.id}/edit`}
                          className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition">
                          <Pencil size={14} />
                        </Link>
                        <button onClick={() => handleDelete(p.id)}
                          className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {page > 1 && (
            <Link href={buildPageHref(page - 1)} className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-sm text-muted-foreground transition">
              ← Prev
            </Link>
          )}
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const p = totalPages <= 7 ? i + 1 : Math.max(1, Math.min(page - 3, totalPages - 6)) + i;
            return (
              <Link key={p} href={buildPageHref(p)}
                className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm transition ${
                  p === page ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted text-muted-foreground"
                }`}
              >
                {p}
              </Link>
            );
          })}
          {page < totalPages && (
            <Link href={buildPageHref(page + 1)} className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-sm text-muted-foreground transition">
              Next →
            </Link>
          )}
          <span className="text-xs text-muted-foreground ml-2">Page {page} of {totalPages}</span>
        </div>
      )}

      {/* Task 5.4: Bulk Price Modal */}
      <BulkPriceModal
        open={bulkPriceOpen}
        onClose={() => setBulkPriceOpen(false)}
        selectedProducts={products.filter((p) => selected.has(p.id)).map((p) => ({ id: p.id, price: Number(p.price) }))}
        onComplete={load}
      />

      {/* Task 5.5: ConfirmDialog */}
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        destructive
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
      />
    </div>
  );
}
