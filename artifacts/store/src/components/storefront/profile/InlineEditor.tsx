import { useEffect, useState, useRef } from "react";
import { Check, X, Edit2 } from "lucide-react";

export function InlineEditor({
  label, value, onSave, readOnly = false, placeholder = "", multiline = false,
}: {
  label: string;
  value: string;
  onSave?: (v: string) => Promise<boolean>;
  readOnly?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    const ok = await onSave(draft.trim());
    setSaving(false);
    if (ok) setEditing(false);
  };

  const handleCancel = () => { setDraft(value); setEditing(false); };

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      {editing ? (
        <div className="flex gap-2 items-start">
          {multiline ? (
            <textarea
              ref={inputRef as any}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder={placeholder}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          ) : (
            <input
              ref={inputRef as any}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50 shrink-0"
          >
            <Check size={14} />
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="p-2 rounded-lg border border-border hover:bg-accent transition shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 min-h-[32px]">
          <p className={`text-sm ${value ? "" : "text-muted-foreground italic"}`}>
            {value || placeholder || "—"}
          </p>
          {!readOnly && onSave && (
            <button
              onClick={() => setEditing(true)}
              className="text-muted-foreground hover:text-primary transition shrink-0 p-1 rounded"
            >
              <Edit2 size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
