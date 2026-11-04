import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, AlertTriangle, Sparkles, TrendingDown, ShieldAlert, Layers } from "lucide-react";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { StocktakeResolutionCard } from "@/components/admin/StocktakeResolutionCard";

interface StocktakeVariancePageProps {
  id: string;
}

export default function StocktakeVariancePage({ id }: StocktakeVariancePageProps) {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchVariance = useCallback(async () => {
    try {
      setLoading(true);
      const res = await adminJson(apiUrl(`/admin/stocktakes/${id}/variance`));
      setData(res);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load variance report");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchVariance();
  }, [fetchVariance]);

  const handleResolve = async (variantId: string, resolutionType: "sum" | "override", chosenLineId?: string, resolvedQty?: number) => {
    try {
      await adminJson(apiUrl(`/admin/stocktakes/${id}/resolve`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variant_id: variantId,
          resolution_type: resolutionType,
          chosen_line_id: chosenLineId,
          resolved_quantity: resolvedQty,
        }),
      });
      fetchVariance();
    } catch (err: any) {
      alert(err?.message || "Failed to resolve conflict");
    }
  };

  const handlePost = async () => {
    if (!confirm("Are you sure you want to post this stocktake? This will write immutable ledger movements and permanently update on-hand inventory.")) return;
    setPosting(true);
    setErrorMsg(null);
    try {
      await adminJson(apiUrl(`/admin/stocktakes/${id}/post`), { method: "POST" });
      setLocation("/admin/stocktakes");
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to post stocktake");
    } finally {
      setPosting(false);
    }
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading variance review…</div>;
  if (!data) return <div className="p-12 text-center text-destructive">{errorMsg || "Stocktake not found"}</div>;

  const { stocktake, items, summary } = data;
  const conflicts = items.filter((it: any) => it.scan_count > 1);
  const isDraft = stocktake.status === "draft";

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/stocktakes" className="p-2 -ml-2 rounded-lg text-muted-foreground hover:bg-muted">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{stocktake.title}</h1>
              {stocktake.is_opening_count && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  <Sparkles size={12} /> Opening Count
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{stocktake.stocktake_number}</p>
          </div>
        </div>

        {isDraft && (
          <button
            onClick={handlePost}
            disabled={posting || summary.unresolved_conflicts_count > 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 disabled:opacity-50 shadow-md"
          >
            <CheckCircle2 size={18} />
            {posting ? "Posting…" : "Post Stocktake"}
          </button>
        )}
      </div>

      {errorMsg && <div className="p-4 text-sm text-destructive bg-destructive/10 rounded-xl">{errorMsg}</div>}

      {/* KPI Cards: §8 Shrinkage in Manat & §7.3 Unvalued units */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-card border border-border rounded-xl shadow-sm space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase">
            <TrendingDown size={16} className="text-destructive" />
            <span>Shrinkage Value</span>
          </div>
          <div className="text-2xl font-bold text-foreground font-mono">{summary.shrinkage_value.toFixed(2)} ₼</div>
          <p className="text-[11px] text-muted-foreground">Loss valued at weighted-avg cost</p>
        </div>

        <div className={`p-5 rounded-xl border shadow-sm space-y-1 ${
          summary.unvalued_shrinkage_units > 0
            ? "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200"
            : "bg-card border-border"
        }`}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase">
            <ShieldAlert size={16} className="text-amber-500" />
            <span>Unvalued Missing</span>
          </div>
          <div className="text-2xl font-bold font-mono">{summary.unvalued_shrinkage_units} units</div>
          <p className="text-[11px] opacity-80">Missing items with 0 ₼ cost basis</p>
        </div>

        <div className="p-5 bg-card border border-border rounded-xl shadow-sm space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase">
            <span>Catalog Coverage</span>
          </div>
          <div className="text-2xl font-bold text-foreground font-mono">{summary.total_items_counted} counted</div>
          <p className="text-[11px] text-muted-foreground">{summary.uncounted_variants_count} uncounted SKUs</p>
        </div>

        <div className="p-5 bg-card border border-border rounded-xl shadow-sm space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase">
            <Layers size={16} className="text-primary" />
            <span>Conflicts</span>
          </div>
          <div className={`text-2xl font-bold font-mono ${summary.unresolved_conflicts_count > 0 ? "text-amber-500" : "text-emerald-500"}`}>
            {summary.unresolved_conflicts_count}
          </div>
          <p className="text-[11px] text-muted-foreground">Duplicate scan collisions</p>
        </div>
      </div>

      {/* R3 Multi-Counter Resolution Section */}
      {conflicts.length > 0 && isDraft && (
        <div className="space-y-3 bg-muted/20 p-5 rounded-2xl border border-border">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Layers size={18} className="text-primary" />
            Multi-Counter Duplicate Scans ({conflicts.length})
          </h2>
          <div className="space-y-3">
            {conflicts.map((c: any) => (
              <StocktakeResolutionCard key={c.variant_id} item={c} onResolve={handleResolve} />
            ))}
          </div>
        </div>
      )}

      {/* Discrepancy Table sorted by value */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-border bg-muted/30 font-semibold text-sm">
          Discrepancy Breakdown (Sorted by Value)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground border-b border-border uppercase">
              <tr>
                <th className="px-4 py-3">Product / SKU</th>
                <th className="px-4 py-3">Counted</th>
                <th className="px-4 py-3">Snapshot</th>
                <th className="px-4 py-3">Variance</th>
                <th className="px-4 py-3">Unit Cost</th>
                <th className="px-4 py-3 text-right">Value (₼)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it: any) => (
                <tr key={it.variant_id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-foreground">{it.product_title}</div>
                    <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
                      <span>{it.sku || "No SKU"}</span>
                      {it.has_interleaved_movements && (
                        <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded font-sans">
                          ⚠️ Trade during count ({it.interleaved_window?.start?.slice(11, 16)}–{it.interleaved_window?.end?.slice(11, 16)})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-foreground">{it.counted_quantity}</td>
                  <td className="px-4 py-3 text-muted-foreground">{it.snapshot_on_hand}</td>
                  <td className="px-4 py-3 font-bold">
                    <span className={it.variance_quantity < 0 ? "text-destructive" : it.variance_quantity > 0 ? "text-emerald-500" : "text-muted-foreground"}>
                      {it.variance_quantity > 0 ? `+${it.variance_quantity}` : it.variance_quantity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono">
                    {it.is_unvalued ? <span className="text-amber-500 text-xs">Unvalued (0 ₼)</span> : `${it.unit_cost.toFixed(2)} ₼`}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold">
                    <span className={it.variance_value < 0 ? "text-destructive" : it.variance_value > 0 ? "text-emerald-500" : "text-muted-foreground"}>
                      {it.variance_value > 0 ? `+${it.variance_value.toFixed(2)}` : it.variance_value.toFixed(2)} ₼
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
