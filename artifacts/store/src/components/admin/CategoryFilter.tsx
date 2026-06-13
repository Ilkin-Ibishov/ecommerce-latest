import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface CategoryFilterProps {
  value: string | null;
  onFilter: (categoryId: string | null) => void;
}

export function CategoryFilter({ value, onFilter }: CategoryFilterProps) {
  const [categories, setCategories] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    const supabase = createClient();
    (supabase as any)
      .from("categories")
      .select("id, category_translations(lang_code, title)")
      .order("id")
      .then(({ data }: any) => {
        setCategories(
          (data ?? []).map((c: any) => ({
            id: c.id,
            title:
              c.category_translations?.find(
                (t: any) => t.lang_code === "az",
              )?.title ?? c.id,
          })),
        );
      });
  }, []);

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onFilter(e.target.value || null)}
      className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none"
    >
      <option value="">All categories</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      ))}
    </select>
  );
}
