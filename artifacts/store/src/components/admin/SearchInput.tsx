import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";

interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
}

export function SearchInput({ placeholder = "Search...", value, onChange, debounceMs = 300 }: SearchInputProps) {
  const [internal, setInternal] = useState(value);

  // Sync external value changes
  useEffect(() => { setInternal(value); }, [value]);

  // Debounce internal changes to parent
  useEffect(() => {
    if (internal === value) return; // Skip if already synced
    const t = setTimeout(() => onChange(internal), debounceMs);
    return () => clearTimeout(t);
  }, [internal, debounceMs]);

  const clear = () => { setInternal(""); onChange(""); };

  return (
    <div className="relative">
      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={internal}
        onChange={(e) => setInternal(e.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-8 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring w-48"
      />
      {internal && (
        <button onClick={clear} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          <X size={13} />
        </button>
      )}
    </div>
  );
}
