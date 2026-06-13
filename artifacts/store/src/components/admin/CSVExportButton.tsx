import { Download } from "lucide-react";

interface CSVColumn<T> {
  key: keyof T | ((row: T) => string | number);
  header: string;
}

interface CSVExportButtonProps<T> {
  data: T[];
  columns: CSVColumn<T>[];
  filename: string;
}

export function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function CSVExportButton<T>({ data, columns, filename }: CSVExportButtonProps<T>) {
  const exportCSV = () => {
    if (data.length === 0) return;
    const header = columns.map((c) => escapeCSV(c.header)).join(",");
    const rows = data.map((row) =>
      columns.map((col) => {
        const val = typeof col.key === "function" ? col.key(row) : row[col.key];
        return escapeCSV(String(val ?? ""));
      }).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={exportCSV}
      disabled={data.length === 0}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Download size={14} /> Export CSV
    </button>
  );
}
