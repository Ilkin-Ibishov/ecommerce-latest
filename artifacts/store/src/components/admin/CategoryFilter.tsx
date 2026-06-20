import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { getTranslatedField } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

interface CategoryFilterProps {
  value: string | null;
  onFilter: (categoryId: string | null) => void;
}

export function CategoryFilter({ value, onFilter }: CategoryFilterProps) {
  const { t } = useI18n();
  const [categories, setCategories] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("categories")
      .select("id, category_translations(lang_code, title)")
      .order("id")
      .then(({ data }) => {
        setCategories(
          (data ?? []).map((c) => ({
            id: c.id,
            title: getTranslatedField(c.category_translations, "az", "title", c.id),
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
      <option value="">{t("Admin.Common.allCategories")}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      ))}
    </select>
  );
}
