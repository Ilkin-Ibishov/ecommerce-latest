import { useEffect, useState, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Plus, Pencil, Trash2, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";

const PAGE_SIZE = 25;

type FlagFilter = "" | "featured" | "sale" | "deal" | "low_stock" | "out_of_stock";

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

  // Debounce search
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

    // Search by AZ title (client-side post-filter for title since we can't easily do !inner with or)
    // For slug search we use ilike directly
    if (searchQuery.trim()) {
      query = query.ilike("slug", `%${searchQuery.trim()}%`);
    }

    // Flag filters
    if (flagFilter === "featured") query = query.eq("is_featured", true);
    else if (flagFilter === "sale") query = query.eq("is_on_sale", true);
    else if (flagFilter === "deal") query = query.eq("is_deal_of_day", true);
    else if (flagFilter === "low_stock") query = query.gt("stock", 0).lt("stock", 10);
    else if (flagFilter === "out_of_stock") query = query.eq("stock", 0);

    const { data, count: total } = await query;
    setProducts(data ?? []);
    setCount(total ?? 0);
    setLoading(false);
  }, [page, searchQuery, flagFilter]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this product? This cannot be undone.")) return;
    await adminFetch(apiUrl(`/admin/products/${id}`), { method: "DELETE" });
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setCount((c) => c - 1);
  };

  const setFlag = (flag: FlagFilter) => {
    const p = new URLSearchParams();
    if (searchQuery) p.set("q", searchQuery);
    if (flag) p.set("flag", flag);
    const qs = p.toString();
    navigate(`/admin/products${qs ? `?${qs}` : ""}`);
  };

  const totalPages = Math.ceil(count / PAGE_SIZE);

  const buildPageHref = (p: number) => {
    const ps = new URLSearchParams();
    if (p > 1) ps.set("page", String(p));
    if (searchQuery) ps.set("q", searchQuery);
    if (flagFilter) ps.set("flag", flagFilter);
    const qs = ps.toString();
    return `/admin/products${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Products</h1>
        <Link
          href="/admin/products/new"
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition"
        >
          <Plus size={16} /> New Product
        </Link>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchInput}
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

        {/* Flag filter */}
        <select
          value={flagFilter}
          onChange={(e) => setFlag(e.target.value as FlagFilter)}
          className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none"
        >
          <option value="">All products</option>
          <option value="featured">Featured only</option>
          <option value="sale">On sale only</option>
          <option value="deal">Deal of day only</option>
          <option value="low_stock">Low stock (&lt;10)</option>
          <option value="out_of_stock">Out of stock</option>
        </select>

        {/* Results count */}
        <span className="text-sm text-muted-foreground sm:ml-auto">
          {count} product{count !== 1 ? "s" : ""}
          {searchQuery && ` matching "${searchQuery}"`}
        </span>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
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
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
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
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20 transition">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0">
                          {img ? <img src={img} alt={title} className="object-cover w-full h-full" /> : <div className="w-full h-full bg-muted" />}
                        </div>
                        <span className="font-medium line-clamp-1 max-w-[200px]">{title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.slug}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{p.brand ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-medium">{Number(p.price).toFixed(2)} AZN</td>
                    <td className={`px-4 py-3 text-right font-medium ${p.stock === 0 ? "text-red-400" : p.stock < 5 ? "text-orange-400" : ""}`}>
                      {p.stock}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {p.is_featured && <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">Featured</span>}
                        {p.is_on_sale && <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Sale</span>}
                        {p.is_deal_of_day && <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">Deal</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/admin/products/${p.id}/edit`} className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition">
                          <Pencil size={14} />
                        </Link>
                        <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition">
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
            // Show pages around current
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
