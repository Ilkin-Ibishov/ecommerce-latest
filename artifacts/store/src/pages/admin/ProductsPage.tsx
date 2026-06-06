import { useEffect, useState, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Plus, Pencil, Trash2, Search, X, Copy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { StockCell } from "@/components/admin/StockCell";

const PAGE_SIZE = 25;
type FlagFilter = "" | "featured" | "sale" | "deal" | "low_stock" | "out_of_stock";

// ── Bulk action toolbar ────────────────────────────────────────────────────
function BulkBar({ count, onFlag, onDelete, onClear }: {
  count: number;
  onFlag: (field: string, value: boolean) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  const Btn = ({ label, onClick, destructive }: { label: string; onClick: () => void; destructive?: boolean }) => (
    <button onClick={onClick}
      className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
        destructive ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      }`}
    >
      {label}
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
  const offset = (page - 1) * PAGE_SIZE;

  const [products, setProducts] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Debounce search → URL
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (searchInput) p.set("q", searchInput);
      if (flagFilter) p.set("flag", flagFilter);
      const qs = p.toString();
      navigate(`/admin/products${qs ? `?${qs}` : ""}`, { replace: true });
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = (supabase as any)
      .from("products")
      .select(
        "id, slug, price, stock, is_featured, is_on_sale, is_deal_of_day, brand, product_images(url, sort_order), product_translations(lang_code, title)",
        { count: "exact" }
      )
      .order("sort_order")
      .range(offset, offset + PAGE_SIZE - 1);

    if (searchQuery.trim()) query = query.ilike("slug", `%${searchQuery.trim()}%`);
    if (flagFilter === "featured") query = query.eq("is_featured", true);
    else if (flagFilter === "sale") query = query.eq("is_on_sale", true);
    else if (flagFilter === "deal") query = query.eq("is_deal_of_day", true);
    else if (flagFilter === "low_stock") query = query.gt("stock", 0).lt("stock", 10);
    else if (flagFilter === "out_of_stock") query = query.eq("stock", 0);

    const { data, count: total } = await query;
    setProducts(data ?? []);
    setCount(total ?? 0);
    setSelected(new Set());
    setLoading(false);
  }, [page, searchQuery, flagFilter]);

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

  const handleBulkDelete = async () => {
    const ids = [...selected];
    if (!confirm(`Delete ${ids.length} product${ids.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    await adminFetch(apiUrl("/admin/products/bulk"), {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    });
    setProducts((prev) => prev.filter((p) => !selected.has(p.id)));
    setCount((c) => c - ids.length);
    setSelected(new Set());
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this product? This cannot be undone.")) return;
    await adminFetch(apiUrl(`/admin/products/${id}`), { method: "DELETE" });
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setCount((c) => c - 1);
  };

  const handleDuplicate = async (id: string) => {
    const res = await adminFetch(apiUrl(`/admin/products/${id}/duplicate`), { method: "POST" });
    const data = await res.json();
    if (data.id) navigate(`/admin/products/${data.id}/edit`);
  };

  const setFlag = (flag: FlagFilter) => {
    const p = new URLSearchParams();
    if (searchQuery) p.set("q", searchQuery);
    if (flag) p.set("flag", flag);
    navigate(`/admin/products${p.toString() ? `?${p.toString()}` : ""}`);
  };

  const buildPageHref = (p: number) => {
    const ps = new URLSearchParams();
    if (p > 1) ps.set("page", String(p));
    if (searchQuery) ps.set("q", searchQuery);
    if (flagFilter) ps.set("flag", flagFilter);
    return `/admin/products${ps.toString() ? `?${ps.toString()}` : ""}`;
  };

  const totalPages = Math.ceil(count / PAGE_SIZE);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Products</h1>
        <Link href="/admin/products/new" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition">
          <Plus size={16} /> New Product
        </Link>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by slug…"
            className="pl-8 pr-8 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring w-48"
          />
          {searchInput && (
            <button onClick={() => setSearchInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={13} />
            </button>
          )}
        </div>

        <select value={flagFilter} onChange={(e) => setFlag(e.target.value as FlagFilter)}
          className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none">
          <option value="">All products</option>
          <option value="featured">Featured only</option>
          <option value="sale">On sale only</option>
          <option value="deal">Deal of day only</option>
          <option value="low_stock">Low stock (&lt;10)</option>
          <option value="out_of_stock">Out of stock</option>
        </select>

        <span className="text-sm text-muted-foreground sm:ml-auto">
          {count} product{count !== 1 ? "s" : ""}{searchQuery && ` matching "${searchQuery}"`}
        </span>
      </div>

      {/* Bulk action bar */}
      <BulkBar
        count={selected.size}
        onFlag={handleBulkFlag}
        onDelete={handleBulkDelete}
        onClear={() => setSelected(new Set())}
      />

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 cursor-pointer" />
                </th>
                <th className="text-left px-4 py-3 font-medium">Product</th>
                <th className="text-left px-4 py-3 font-medium">Slug</th>
                <th className="text-left px-4 py-3 font-medium">Brand</th>
                <th className="text-right px-4 py-3 font-medium">Price</th>
                <th className="text-right px-4 py-3 font-medium">Stock</th>
                <th className="text-left px-4 py-3 font-medium">Flags</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  {searchQuery || flagFilter
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
                          {img ? <img src={img} alt={title} className="object-cover w-full h-full" /> : <div className="w-full h-full bg-muted" />}
                        </div>
                        <span className="font-medium line-clamp-1 max-w-[180px]">{title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.slug}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{p.brand ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-medium">{Number(p.price).toFixed(2)} AZN</td>
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
    </div>
  );
}
