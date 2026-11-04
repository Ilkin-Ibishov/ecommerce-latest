import { useState } from "react";
import { X, ClipboardCheck, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { adminJson } from "@/lib/admin-fetch";
import { apiUrl } from "@/lib/api";

interface NewStocktakeModalProps {
  open: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onCreated: (stocktakeId: string) => void;
}

export function NewStocktakeModal({ open, isAdmin, onClose, onCreated }: NewStocktakeModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [isOpeningCount, setIsOpeningCount] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Please enter a stocktake title");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        title: title.trim(),
        notes: notes.trim() || undefined,
        is_opening_count: isAdmin ? isOpeningCount : false,
      };

      const res = await adminJson(apiUrl("/admin/stocktakes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      onCreated(res.id);
    } catch (err: any) {
      setError(err?.message || "Failed to create stocktake");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <ClipboardCheck size={20} className="text-primary" />
            <span>{t("Admin.Stocktakes.newCount")}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-lg">{error}</div>}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Stocktake Title *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Q4 Full Floor Count, Main Store Room"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {isAdmin && (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isOpeningCount}
                  onChange={(e) => setIsOpeningCount(e.target.checked)}
                  className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
                />
                <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles size={16} className="text-amber-500" />
                  Establish Initial Opening Count (Go-Live)
                </span>
              </label>
              <p className="text-xs text-muted-foreground leading-relaxed pl-7">
                Sets the baseline opening balance for the entire shop. Replaces initial zero stock with opening_balance
                movements and lets you assign initial wholesale costs.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Notes (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="Staff assignments, physical zones covered, or audit notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Creating…" : "Start Counting"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
