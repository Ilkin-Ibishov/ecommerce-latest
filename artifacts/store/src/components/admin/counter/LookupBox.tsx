import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch } from "@/lib/admin-fetch";
import { ScanLine } from "lucide-react";
import type { LookupItem } from "./types";

// One box for the scanner, a typed barcode and a typed name (M3 spec §7). A scanner is a
// keyboard that types fast and presses Enter, so the box keeps focus after every action.
export function LookupBox({ onResults, disabled }: {
  onResults: (items: LookupItem[]) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!disabled && !busy) input.current?.focus(); }, [disabled, busy]);

  const submit = async () => {
    const q = text.trim();
    if (!q) return;
    setBusy(true);
    setNotFound(false);
    try {
      const res = await adminFetch(apiUrl(`/admin/counter/lookup?q=${encodeURIComponent(q)}`));
      const data = res.ok ? await res.json() : { items: [] };
      if (data.items.length === 0) {
        setNotFound(true); // keep the text so the cashier can correct it
      } else {
        setText("");
        onResults(data.items);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
        <ScanLine className="h-5 w-5 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          value={text}
          disabled={disabled}
          onChange={(e) => { setText(e.target.value); setNotFound(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
          onBlur={() => { if (!disabled) setTimeout(() => input.current?.focus(), 0); }}
          placeholder="Barkodu oxudun və ya adı yazın"
          aria-label="Barkod və ya məhsul adı"
          className="w-full bg-transparent py-3 text-lg outline-none"
          autoComplete="off"
        />
      </div>
      {notFound && <p role="status" className="mt-1 text-sm text-destructive">Tapılmadı</p>}
    </div>
  );
}
