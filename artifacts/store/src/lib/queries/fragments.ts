// Reusable Supabase `select(...)` fragments — defined ONCE and reused by every
// query wrapper / caller (R7.3, R7.4). Keeping these strings in a single place
// means the embedded-relation shape is identical across all callers and there is
// exactly one definition to keep in sync with the schema.

/**
 * Product select with the embedded relations the store pages rely on:
 * images, translations, and the category join rows. Matches the shape returned
 * by the inline product queries so migrating callers see no change.
 */
export const PRODUCT_SELECT =
  "id, slug, price, stock, brand, product_images(*), product_translations(*), product_categories(category_id)";

/**
 * Category-tree node select: the node's own fields (including `parent_id`, used
 * to assemble the root/subcategory tree) plus its translations.
 */
export const CATEGORY_TREE_SELECT =
  "id, slug, parent_id, icon_url, category_translations(*)";
