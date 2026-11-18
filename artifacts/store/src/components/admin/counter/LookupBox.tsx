import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { ScanLine, X } from "lucide-react";
import type { LookupItem } from "./types";
import { useI18n } from "@/lib/i18n/context";

// One box for the scanner, a typed barcode and a typed name (M3 spec §7). A scanner is a
// keyboard that types fast and presses Enter, so the box keeps focus after every action.
export function LookupBox({ onResults, disabled, resetSignal }: {
  onResults: (items: LookupItem[]) => void;
  disabled?: boolean;
  resetSignal?: string | number;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // A failed request (401/429/500, network) is not "no such product": keep the two apart.
  const [miss, setMiss] = useState<"Admin.Counter.notFound" | "Admin.Counter.lookupFailed" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (disabled || busy) return;
    const active = document.activeElement;
    if (!active || active === document.body || active === input.current) input.current?.focus();
  }, [disabled, busy]);

  useEffect(() => {
    if (disabled) return;
    const returnFocus = () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body) input.current?.focus();
      }, 0);
    };
    document.addEventListener("focusout", returnFocus);
    return () => document.removeEventListener("focusout", returnFocus);
  }, [disabled]);

  useEffect(() => {
    if (resetSignal !== undefined) {
      setText("");
      setMiss(null);
      if (!disabled) input.current?.focus();
    }
  }, [resetSignal, disabled]);

  const submit = async () => {
    const q = text.trim();
    if (!q) return;
    setBusy(true);
    setMiss(null);
    try {
      const res = await adminFetch(apiUrl(`/admin/counter/lookup?q=${encodeURIComponent(q)}`));
      if (!res.ok) {
        setMiss("Admin.Counter.lookupFailed"); // keep the text so the cashier can retry
        return;
      }
      const data = await res.json();
      if (data.items.length === 0) {
        setMiss("Admin.Counter.notFound"); // keep the text so the cashier can correct it
      } else {
        setText("");
        onResults(data.items);
      }
    } catch {
      setMiss("Admin.Counter.lookupFailed");
    } finally {
      setBusy(false);
    }
  };

  const handleClear = () => {
    setText("");
    setMiss(null);
    input.current?.focus();
  };

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
        <ScanLine className="h-5 w-5 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          value={text}
          disabled={disabled}
          onChange={(e) => { setText(e.target.value); setMiss(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              handleClear();
            }
          }}
          onBlur={(e) => {
            const next = e.relatedTarget;
            if (disabled || next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement || next instanceof HTMLSelectElement) return;
            setTimeout(() => input.current?.focus(), 0);
          }}
          placeholder={t("Admin.Counter.lookupPlaceholder")}
          aria-label={t("Admin.Counter.lookupAriaLabel")}
          className="w-full bg-transparent py-3 text-lg outline-none"
          autoComplete="off"
        />
        {text && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("Admin.Counter.clearSearch")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {miss && <p role="status" className="mt-1 text-sm text-destructive">{t(miss)}</p>}
    </div>
  );
}
