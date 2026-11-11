import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch, adminJson } from "@/lib/admin-fetch";
import { LookupBox } from "@/components/admin/counter/LookupBox";
import { VariantPicker } from "@/components/admin/counter/VariantPicker";
import { optionLabel, type LookupItem } from "@/components/admin/counter/types";

interface Bundle {
  id: string; name: string; bundle_price: number | null; is_active: boolean;
  bundle_lines: { variant_id: string; quantity: number; product_variants: { sku: string | null } | null }[];
}
interface DraftLine { variant_id: string; label: string; quantity: number }
interface Draft { id?: string; name: string; price: string; lines: DraftLine[] }

const empty: Draft = { name: "", price: "", lines: [] };

// Owner-only bundle editor (M3 spec §10): a named list of variants and an optional price.
// No stock, no assembly; the till adds the lines and the server computes the discount.
export default function BundlesPage() {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picker, setPicker] = useState<LookupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => adminFetch(apiUrl("/admin/bundles")).then((r) => (r.ok ? r.json() : [])).then(setBundles).catch(() => {});
  useEffect(() => { void load(); }, []);

  const addLine = (item: LookupItem) => {
    setPicker(null);
    setDraft((d) => d && (d.lines.some((l) => l.variant_id === item.variant_id) ? d : {
      ...d, lines: [...d.lines, { variant_id: item.variant_id, label: `${item.title} ${optionLabel(item.options)}`.trim(), quantity: 1 }],
    }));
  };

  const save = async () => {
    if (!draft) return;
    setError(null);
    const body = JSON.stringify({
      name: draft.name.trim(),
      bundle_price: draft.price.trim() === "" ? null : Number(draft.price),
      lines: draft.lines.map(({ variant_id, quantity }) => ({ variant_id, quantity })),
    });
    try {
      await adminJson(apiUrl(draft.id ? `/admin/bundles/${draft.id}` : "/admin/bundles"), { method: draft.id ? "PUT" : "POST", body });
      setDraft(null);
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deactivate = async (b: Bundle) => {
    if (!confirm(`"${b.name}" deaktiv edilsin?`)) return;
    await adminFetch(apiUrl(`/admin/bundles/${b.id}`), { method: "DELETE" });
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dəstlər</h1>
        <button type="button" onClick={() => setDraft({ ...empty })} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">Yeni dəst</button>
      </div>

      {draft && (
        <section className="space-y-3 rounded-xl border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Ad
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5" />
            </label>
            <label className="text-sm">Dəst qiyməti (boş = endirimsiz)
              <input type="number" min="0" step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5" />
            </label>
          </div>
          <LookupBox disabled={!!picker} onResults={(items) => (items.length === 1 ? addLine(items[0]) : setPicker(items))} />
          <ul className="space-y-1 text-sm">
            {draft.lines.map((l, i) => (
              <li key={l.variant_id} className="flex items-center gap-2">
                <span className="flex-1">{l.label}</span>
                <input type="number" min="1" step="1" value={l.quantity} aria-label="Say"
                  onChange={(e) => setDraft({ ...draft, lines: draft.lines.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x)) })}
                  className="w-16 rounded border border-border bg-background px-2 py-1 text-right" />
                <button type="button" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })} className="text-destructive underline">Sil</button>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} disabled={!draft.name.trim() || draft.lines.length === 0} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Yadda saxla</button>
            <button type="button" onClick={() => setDraft(null)} className="rounded-lg bg-muted px-3 py-2 text-sm">Ləğv</button>
          </div>
        </section>
      )}

      <ul className="divide-y divide-border">
        {bundles.map((b) => (
          <li key={b.id} className={`flex items-center gap-3 py-3 ${b.is_active ? "" : "opacity-50"}`}>
            <div className="flex-1">
              <p className="font-medium">{b.name}{b.bundle_price !== null && ` · ${Number(b.bundle_price).toFixed(2)} AZN`}</p>
              <p className="text-sm text-muted-foreground">{b.bundle_lines.map((l) => `${l.product_variants?.sku ?? "?"} × ${l.quantity}`).join(", ")}</p>
            </div>
            {b.is_active && (
              <>
                <button type="button" className="text-sm underline" onClick={() => setDraft({
                  id: b.id, name: b.name, price: b.bundle_price === null ? "" : String(b.bundle_price),
                  lines: b.bundle_lines.map((l) => ({ variant_id: l.variant_id, label: l.product_variants?.sku ?? l.variant_id, quantity: l.quantity })),
                })}>Redaktə</button>
                <button type="button" className="text-sm text-destructive underline" onClick={() => void deactivate(b)}>Deaktiv et</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {picker && <VariantPicker items={picker} onPick={addLine} onClose={() => setPicker(null)} />}
    </div>
  );
}
