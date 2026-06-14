import { useState } from "react";
import { ArrowUpDown, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

export type SortOption = "newest" | "price_asc" | "price_desc" | "name";

export interface SortDropdownProps {
  value: SortOption;
  onChange: (v: SortOption) => void;
}

const SORT_OPTIONS: { value: SortOption; labelKey: string }[] = [
  { value: "newest", labelKey: "SortDropdown.newest" },
  { value: "price_asc", labelKey: "SortDropdown.priceAsc" },
  { value: "price_desc", labelKey: "SortDropdown.priceDesc" },
  { value: "name", labelKey: "SortDropdown.name" },
];

/**
 * Storefront sort selector. Reproduces the existing sort dropdown markup used
 * across ProductsPage/CategoryPage; all labels resolve through i18n `t()`.
 */
export function SortDropdown({ value, onChange }: SortDropdownProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((o) => o.value === value) ?? SORT_OPTIONS[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent transition"
      >
        <ArrowUpDown size={14} />
        {t(current.labelKey)}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-52 bg-background border border-border rounded-xl shadow-lg z-40 overflow-hidden">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`block w-full text-left px-4 py-2.5 text-sm transition hover:bg-accent ${value === opt.value ? "text-primary font-semibold bg-primary/5" : ""}`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default SortDropdown;
