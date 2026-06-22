import { Link } from "wouter";
import { useI18n } from "@/lib/i18n/context";
import { getTranslatedField } from "@/lib/utils";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { CategoryNode } from "@/lib/queries/categories";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BreadcrumbSegment {
  label: string;
  href: string;
}

export interface StorefrontBreadcrumbProps {
  segments: BreadcrumbSegment[];
  currentLabel: string;
}

export interface BreadcrumbJsonLd {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item?: string;
  }>;
}

// ─── Pure Functions (exported for property testing) ───────────────────────────

/**
 * Recursively searches the category tree for the target category ID
 * and builds an ordered ancestor chain from root to the target.
 * Returns an empty array if the target is not found.
 *
 * @param categoryTree - The full category tree (from getCategoriesTree)
 * @param targetCategoryId - The ID of the category to find
 * @param locale - Optional locale for translating category names (defaults to slug if not provided)
 */
export function resolveBreadcrumbPath(
  categoryTree: CategoryNode[],
  targetCategoryId: string,
  locale: string = "",
): BreadcrumbSegment[] {
  function search(
    nodes: CategoryNode[],
    ancestors: BreadcrumbSegment[],
  ): BreadcrumbSegment[] | null {
    for (const node of nodes) {
      const label = getTranslatedField(
        node.category_translations,
        locale,
        "title",
        node.slug,
      );
      const segment: BreadcrumbSegment = {
        label,
        href: `/categories/${node.slug}`,
      };
      const currentPath = [...ancestors, segment];

      if (node.id === targetCategoryId) {
        return currentPath;
      }

      if (node.subcategories && node.subcategories.length > 0) {
        const found = search(node.subcategories, currentPath);
        if (found) return found;
      }
    }
    return null;
  }

  return search(categoryTree, []) ?? [];
}

/**
 * Generates a JSON-LD BreadcrumbList schema object for SEO.
 * Positions are numbered from 1 (Home) through all segments to the current page.
 */
export function generateBreadcrumbJsonLd(
  segments: Array<{ label: string; href: string }>,
  currentLabel: string,
  baseUrl: string,
): BreadcrumbJsonLd {
  const items: BreadcrumbJsonLd["itemListElement"] = [];

  for (let i = 0; i < segments.length; i++) {
    items.push({
      "@type": "ListItem",
      position: i + 1,
      name: segments[i].label,
      item: `${baseUrl}${segments[i].href}`,
    });
  }

  // Final segment (current page) — no `item` URL per schema.org recommendation
  items.push({
    "@type": "ListItem",
    position: segments.length + 1,
    name: currentLabel,
  });

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StorefrontBreadcrumb({
  segments,
  currentLabel,
}: StorefrontBreadcrumbProps) {
  const { t, locale } = useI18n();

  const homeLabel = t("Breadcrumb.home");
  const homeSegment: BreadcrumbSegment = {
    label: homeLabel,
    href: `/${locale}`,
  };

  const allSegments = [homeSegment, ...segments];
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const jsonLd = generateBreadcrumbJsonLd(allSegments, currentLabel, baseUrl);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Breadcrumb aria-label="Breadcrumb">
        <BreadcrumbList className="overflow-x-auto whitespace-nowrap flex-nowrap">
          {allSegments.map((segment, index) => (
            <BreadcrumbItem key={`${segment.href}-${index}`}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbLink asChild>
                <Link href={segment.href}>{segment.label}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
          ))}
          <BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbPage>{currentLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </>
  );
}
