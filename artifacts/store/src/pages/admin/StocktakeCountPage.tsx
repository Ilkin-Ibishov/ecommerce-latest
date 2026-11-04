import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Barcode, Check, MapPin, Plus, Minus, AlertCircle } from "lucide-react";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";
import { StocktakeRecentLines } from "@/components/admin/StocktakeRecentLines";
import { StocktakeTypoModal } from "@/components/admin/StocktakeTypoModal";

interface StocktakeCountPageProps {
  id: string;
}

export default function StocktakeCountPage({ id }: StocktakeCountPageProps) {
  const [, setLocation] = useLocation();
  const [stocktake, setStocktake] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Scanner state
  const [barcodeInput, setBarcodeInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [activeVariant, setActiveVariant] = useState<any>(null);
  const [countedQty, setCountedQty] = useState("1");
  const [currentLocation, setCurrentLocation] = useState("Shelf A");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Typo edit modal state (R1)
  const [editingLine, setEditingLine] = useState<any | null>(null);
  const [editQty, setEditQty] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  const fetchStocktake = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminJson(apiUrl(`/admin/stocktakes/${id}`));
      setStocktake(data.stocktake);
      setLines(data.lines ?? []);
    } catch {
      setLocation("/admin/stocktakes");
    } finally {
      setLoading(false);
    }
  }, [id, setLocation]);

  useEffect(() => {
    fetchStocktake();
  }, [fetchStocktake]);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;
    setSearching(true);
    setErrorMsg(null);
    try {
      const res = await adminJson(apiUrl(`/inventory/scan/${encodeURIComponent(code)}`));
      const matches = res.matches ?? [];
      if (matches.length > 0) {
        setActiveVariant(matches[0]);
        setCountedQty("1");
      } else {
        setErrorMsg(`Item "${code}" not found in catalog`);
      }
    } catch {
      setErrorMsg(`Barcode "${code}" not recognized`);
    } finally {
      setSearching(false);
      setBarcodeInput("");
    }
  };

  const handleSaveCount = async () => {
    if (!activeVariant) return;
    const qty = parseFloat(countedQty);
    if (isNaN(qty) || qty < 0) {
      setErrorMsg("Please enter a valid count quantity");
      return;
    }

    try {
      const newLine = await adminJson(apiUrl(`/admin/stocktakes/${id}/lines`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variant_id: activeVariant.variant_id,
          counted_quantity: qty,
          location_note: currentLocation,
        }),
      });

      setLines((prev) => [newLine, ...prev]);
      setActiveVariant(null);
      setCountedQty("1");
      setErrorMsg(null);
      inputRef.current?.focus();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save count line");
    }
  };

  // R1: Fix Typo (keeps original snapshot)
  const handleSaveTypoFix = async () => {
    if (!editingLine) return;
    const qty = parseFloat(editQty);
    if (isNaN(qty) || qty < 0) return;
    try {
      const updated = await adminJson(apiUrl(`/admin/stocktakes/${id}/lines/${editingLine.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counted_quantity: qty }),
      });
      setLines((prev) => prev.map((l) => (l.id === editingLine.id ? { ...l, counted_quantity: updated.counted_quantity } : l)));
      setEditingLine(null);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to update typo");
    }
  };

  // R1: Recount Shelf (deletes old line, prompts fresh observation)
  const handleRecount = async (line: any) => {
    if (!confirm(`Recount shelf for ${line.product_title || line.sku}? Captures fresh observation snapshot.`)) return;
    try {
      await adminJson(apiUrl(`/admin/stocktakes/${id}/lines/${line.id}`), { method: "DELETE" });
      setLines((prev) => prev.filter((l) => l.id !== line.id));
      setActiveVariant({
        variant_id: line.variant_id,
        sku: line.sku,
        product_title: line.product_title,
      });
      setCountedQty("1");
      if (line.location_note) setCurrentLocation(line.location_note);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to initiate recount");
    }
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading counter…</div>;

  return (
    <div className="max-w-md mx-auto space-y-4 pb-12 px-2">
      <div className="flex items-center justify-between border-b border-border pb-3 pt-1">
        <Link href="/admin/stocktakes" className="p-2 -ml-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft size={22} />
        </Link>
        <div className="text-center flex-1">
          <h1 className="text-base font-bold text-foreground leading-tight truncate">{stocktake?.title}</h1>
          <p className="text-xs text-muted-foreground font-mono">{stocktake?.stocktake_number}</p>
        </div>
        <div className="px-2.5 py-1 rounded-full bg-primary/10 text-primary font-bold text-xs">{lines.length} scans</div>
      </div>

      <div className="bg-card border border-border rounded-xl p-3 flex items-center justify-between gap-2 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <MapPin size={16} className="text-primary" />
          <span>Location:</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {["Shelf A", "Shelf B", "Store Room", "Front"].map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => setCurrentLocation(loc)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                currentLocation === loc ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {loc}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-3">
        <form onSubmit={handleScan} className="flex gap-2">
          <div className="relative flex-1">
            <Barcode size={18} className="absolute left-3 top-3 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              autoFocus
              placeholder="Scan barcode or type SKU…"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-input bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button type="submit" disabled={searching} className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90">
            {searching ? "…" : "Find"}
          </button>
        </form>

        {errorMsg && <div className="p-2.5 text-xs text-destructive bg-destructive/10 rounded-lg flex items-center gap-2"><AlertCircle size={14} /><span>{errorMsg}</span></div>}

        {activeVariant && (
          <div className="pt-2 border-t border-border space-y-3 animate-in fade-in">
            <div className="bg-muted/40 p-3 rounded-lg">
              <div className="text-sm font-bold text-foreground">{activeVariant.product_title || activeVariant.label}</div>
              <div className="text-xs font-mono text-muted-foreground">SKU: {activeVariant.sku}</div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Count:</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setCountedQty(String(Math.max(0, (parseFloat(countedQty) || 0) - 1)))} className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center font-bold active:scale-95"><Minus size={16} /></button>
                <input type="number" min="0" step="any" value={countedQty} onChange={(e) => setCountedQty(e.target.value)} className="w-20 py-2 text-center text-lg font-bold rounded-lg border border-input bg-background" />
                <button type="button" onClick={() => setCountedQty(String((parseFloat(countedQty) || 0) + 1))} className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center font-bold active:scale-95"><Plus size={16} /></button>
              </div>
            </div>

            <button onClick={handleSaveCount} className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 shadow-md flex items-center justify-center gap-2 active:scale-98">
              <Check size={18} /> Save Count ({countedQty})
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2 pt-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">Your Recent Counts</h2>
        <StocktakeRecentLines
          lines={lines}
          onFixTypo={(l) => { setEditingLine(l); setEditQty(String(l.counted_quantity)); }}
          onRecount={handleRecount}
        />
      </div>

      <StocktakeTypoModal
        open={Boolean(editingLine)}
        editQty={editQty}
        onQtyChange={setEditQty}
        onCancel={() => setEditingLine(null)}
        onSave={handleSaveTypoFix}
      />
    </div>
  );
}
