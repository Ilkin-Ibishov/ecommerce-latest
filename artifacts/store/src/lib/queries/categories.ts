import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@workspace/supabase-types";
import { CATEGORY_TREE_SELECT } from "./fragments";

/**
 * A node in the category tree. Carries the node's own fields plus its
 * translations and, for root nodes, the nested `subcategories` array — matching
 * the root/subcategory shape the store category pages render today.
 */
export type CategoryNode = Pick<Tables<"categories">, "id" | "slug" | "parent_id" | "icon_url"> & {
  category_translations: Tables<"category_translations">[];
  subcategories: CategoryNode[];
};

// The flat row shape returned by the CATEGORY_TREE_SELECT query (before tree assembly).
type CategoryFlatRow = Pick<Tables<"categories">, "id" | "slug" | "parent_id" | "icon_url"> & {
  category_translations: Tables<"category_translations">[];
};

/**
 * Centralized category-tree query. Fetches every category once with the shared
 * {@link CATEGORY_TREE_SELECT} fragment (ordered by `id`), then assembles the
 * root → subcategories tree in memory. Root categories (`parent_id === null`)
 * become top-level nodes; each child is nested under its parent's
 * `subcategories` array.
 */
export async function getCategoriesTree(
  client: SupabaseClient<Database>,
): Promise<CategoryNode[]> {
  const { data } = await client
    .from("categories")
    .select(CATEGORY_TREE_SELECT)
    .order("id", { ascending: true });

  const flat = (data ?? []) as unknown as CategoryFlatRow[];

  const roots: CategoryNode[] = [];
  const byId = new Map<string, CategoryNode>();

  // First pass: create every node with an empty subcategories array.
  for (const row of flat) {
    byId.set(row.id, { ...row, subcategories: [] });
  }

  // Second pass: attach children to parents, collect roots.
  for (const row of flat) {
    const node = byId.get(row.id)!;
    if (row.parent_id && byId.has(row.parent_id)) {
      byId.get(row.parent_id)!.subcategories.push(node);
    } else if (row.parent_id === null) {
      roots.push(node);
    }
  }

  return roots;
}
