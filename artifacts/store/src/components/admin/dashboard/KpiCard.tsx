import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────
export function deltaClass(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct > 0) return "text-green-400";
  if (pct < 0) return "text-red-400";
  return "text-muted-foreground";
}

export function DeltaIcon({ pct, inverted = false }: { pct: number | null; inverted?: boolean }) {
  if (pct === null || pct === 0) return <Minus size={11} className="text-muted-foreground" />;
  const isGood = inverted ? pct < 0 : pct > 0;
  return isGood
    ? <TrendingUp size={11} className="text-green-400" />
    : <TrendingDown size={11} className="text-red-400" />;
}

export function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  if (!isFinite(pct)) return pct > 0 ? "+∞%" : "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function computeDelta(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((current - prev) / prev) * 100;
}

// ─── KPI Card ─────────────────────────────────────────────────
export function KpiCard({
  label, value, sub, accent, pct, invertDelta = false,
}: {
  label: string; value: string | number; sub?: string; accent: string; pct: number | null; invertDelta?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      <div className="flex items-center gap-1.5">
        <DeltaIcon pct={pct} inverted={invertDelta} />
        <span className={`text-xs font-medium ${invertDelta && pct !== null ? (pct < 0 ? "text-green-400" : pct > 0 ? "text-red-400" : "text-muted-foreground") : deltaClass(pct)}`}>
          {formatPct(pct)}
        </span>
        <span className="text-xs text-muted-foreground">vs prior period</span>
      </div>
      {sub && <p className="text-xs text-muted-foreground -mt-1">{sub}</p>}
    </div>
  );
}
