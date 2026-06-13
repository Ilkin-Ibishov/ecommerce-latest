import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SortableHeaderProps {
  label: string;
  sortKey: string;
  currentSort: string | null;
  currentDir: "asc" | "desc";
  onSort: (key: string, dir: "asc" | "desc") => void;
  className?: string;
}

export function SortableHeader({ label, sortKey, currentSort, currentDir, onSort, className }: SortableHeaderProps) {
  const isActive = currentSort === sortKey;
  const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";

  return (
    <th
      className={cn("px-4 py-3 font-medium cursor-pointer hover:text-foreground transition select-none text-muted-foreground", className)}
      onClick={() => onSort(sortKey, nextDir)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          currentDir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />
        ) : (
          <ChevronsUpDown size={14} className="opacity-30" />
        )}
      </span>
    </th>
  );
}
