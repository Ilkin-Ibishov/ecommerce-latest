import { Link } from "wouter";
import { useI18n } from "@/lib/i18n/context";

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Builds the href for a given page number; preserves wouter <Link> URL behavior. */
  buildHref: (page: number) => string;
}

/**
 * Shared admin list pagination. Reproduces the windowed pagination markup used
 * by the admin list pages (UsersPage): a Prev link, up to 7 numbered page
 * links, a Next link, and a "Page X of Y" indicator. Renders nothing when there
 * is a single page or fewer. Uses wouter <Link> so URL behavior matches the
 * existing inline pagination.
 */
export function Pagination({ page, totalPages, buildHref }: PaginationProps) {
  const { t } = useI18n();

  if (totalPages <= 1) return null;

  const windowSize = Math.min(totalPages, 7);
  const windowStart = totalPages <= 7 ? 1 : Math.max(1, Math.min(page - 3, totalPages - 6));

  return (
    <nav className="flex items-center justify-center gap-1.5" aria-label="Pagination">
      {page > 1 && (
        <Link
          href={buildHref(page - 1)}
          aria-label="Previous page"
          className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-sm text-muted-foreground transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {t("Admin.Common.prev")}
        </Link>
      )}
      {Array.from({ length: windowSize }, (_, i) => {
        const p = windowStart + i;
        const isCurrent = p === page;
        return (
          <Link
            key={p}
            href={buildHref(p)}
            aria-label={`Page ${p}`}
            aria-current={isCurrent ? "page" : undefined}
            className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
              isCurrent ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted text-muted-foreground"
            }`}
          >
            {p}
          </Link>
        );
      })}
      {page < totalPages && (
        <Link
          href={buildHref(page + 1)}
          aria-label="Next page"
          className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-sm text-muted-foreground transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {t("Admin.Common.next")}
        </Link>
      )}
      <span className="text-xs text-muted-foreground ml-2">
        {t("Admin.Common.pageOf").replace("{page}", String(page)).replace("{total}", String(totalPages))}
      </span>
    </nav>
  );
}
