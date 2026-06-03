import { useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { Search, Tag } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

interface ProductSuggestion {
  id: string;
  slug: string;
  title: string;
  price: number;
  image: string | null;
}

interface CategorySuggestion {
  id: string;
  slug: string;
  title: string;
}

interface SearchSuggestionsProps {
  products: ProductSuggestion[];
  categories: CategorySuggestion[];
  query: string;
  locale: string;
  visible: boolean;
  activeIndex: number;
  onClose: () => void;
  onSelect: () => void;
}

export default function SearchSuggestions({
  products,
  categories,
  query,
  locale,
  visible,
  activeIndex,
  onClose,
  onSelect,
}: SearchSuggestionsProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (visible) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [visible, handleClickOutside]);

  if (!visible || (products.length === 0 && categories.length === 0)) {
    // Show "no results" only if query is valid length
    if (!visible || query.length < 2) return null;
    return (
      <div
        ref={containerRef}
        className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-xl shadow-xl z-50 p-4 text-center"
      >
        <p className="text-sm text-muted-foreground">{t("SearchSuggestions.noResults")}</p>
        <Link
          href={`/${locale}/products`}
          onClick={onSelect}
          className="text-sm text-primary hover:underline mt-1 inline-block"
        >
          {t("SearchSuggestions.browseAll")}
        </Link>
      </div>
    );
  }

  let itemIndex = -1;

  return (
    <div
      ref={containerRef}
      className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-xl shadow-xl z-50 overflow-hidden"
    >
      {/* Product suggestions */}
      {products.length > 0 && (
        <ul className="py-1">
          {products.map((product) => {
            itemIndex++;
            const isActive = itemIndex === activeIndex;
            return (
              <li key={product.id}>
                <Link
                  href={`/${locale}/products/${product.slug}`}
                  onClick={onSelect}
                  className={`flex items-center gap-3 px-4 py-2.5 transition ${isActive ? "bg-accent" : "hover:bg-accent/50"}`}
                >
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0">
                    {product.image ? (
                      <img src={product.image} alt={product.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        <Search size={14} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{product.title}</p>
                    <p className="text-xs text-primary font-semibold">{Number(product.price).toFixed(2)} AZN</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Category suggestions */}
      {categories.length > 0 && (
        <div className="border-t border-border">
          <p className="px-4 pt-2 pb-1 text-xs text-muted-foreground font-medium">{t("SearchSuggestions.categories")}</p>
          <ul className="pb-1">
            {categories.map((cat) => {
              itemIndex++;
              const isActive = itemIndex === activeIndex;
              return (
                <li key={cat.id}>
                  <Link
                    href={`/${locale}/categories/${cat.slug}`}
                    onClick={onSelect}
                    className={`flex items-center gap-2 px-4 py-2 text-sm transition ${isActive ? "bg-accent" : "hover:bg-accent/50"}`}
                  >
                    <Tag size={14} className="text-muted-foreground shrink-0" />
                    <span className="truncate">{cat.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* "View all" link */}
      <div className="border-t border-border px-4 py-2.5">
        <Link
          href={`/${locale}/search?q=${encodeURIComponent(query)}`}
          onClick={onSelect}
          className="text-sm text-primary hover:underline font-medium"
        >
          {t("SearchSuggestions.viewAll")} &ldquo;{query}&rdquo;
        </Link>
      </div>
    </div>
  );
}
