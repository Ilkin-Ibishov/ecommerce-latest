import { useEffect, useState, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n/context";
import { Loader2, RefreshCw } from "lucide-react";

interface PageTranslation {
  id: string;
  locale: string;
  title: string;
  content: string;
  meta_title: string | null;
  meta_description: string | null;
}

interface CmsPageData {
  id: string;
  slug: string;
  translation: PageTranslation;
  available_locales: string[];
}

type PageState = "loading" | "success" | "not-found" | "error";

export default function CmsPage({ locale, slug }: { locale: string; slug: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<PageState>("loading");
  const [page, setPage] = useState<CmsPageData | null>(null);

  const fetchPage = useCallback(async () => {
    setState("loading");
    setPage(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(
        apiUrl(`/pages/${slug}?locale=${locale}`),
        { signal: controller.signal }
      );

      clearTimeout(timeout);

      if (res.status === 404) {
        setState("not-found");
        return;
      }

      if (!res.ok) {
        setState("error");
        return;
      }

      const data: CmsPageData = await res.json();
      setPage(data);
      setState("success");
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        setState("error");
      } else {
        setState("error");
      }
    }
  }, [slug, locale]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // SEO: set document title, meta description, canonical, and hreflang tags
  useEffect(() => {
    if (state !== "success" || !page) return;

    const { translation, available_locales, slug: pageSlug } = page;

    // Set document title: meta_title if non-empty, else fall back to title
    const metaTitle = translation.meta_title?.trim();
    const previousTitle = document.title;
    document.title = metaTitle ? metaTitle : translation.title;

    // Meta description: create/update if non-empty, remove otherwise
    const metaDesc = translation.meta_description?.trim();
    let descTag = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (metaDesc) {
      if (!descTag) {
        descTag = document.createElement("meta");
        descTag.setAttribute("name", "description");
        document.head.appendChild(descTag);
      }
      descTag.setAttribute("content", metaDesc);
      descTag.setAttribute("data-cms-seo", "true");
    } else if (descTag && descTag.getAttribute("data-cms-seo") === "true") {
      descTag.remove();
    }

    // Canonical link
    const origin = window.location.origin;
    let canonicalTag = document.querySelector('link[rel="canonical"][data-cms-seo="true"]') as HTMLLinkElement | null;
    if (!canonicalTag) {
      canonicalTag = document.createElement("link");
      canonicalTag.setAttribute("rel", "canonical");
      canonicalTag.setAttribute("data-cms-seo", "true");
      document.head.appendChild(canonicalTag);
    }
    canonicalTag.setAttribute("href", `${origin}/${locale}/page/${pageSlug}`);

    // Hreflang alternate links — one per available locale
    const hreflangTags: HTMLLinkElement[] = [];
    for (const loc of available_locales) {
      const tag = document.createElement("link");
      tag.setAttribute("rel", "alternate");
      tag.setAttribute("hreflang", loc);
      tag.setAttribute("href", `${origin}/${loc}/page/${pageSlug}`);
      tag.setAttribute("data-cms-seo", "true");
      document.head.appendChild(tag);
      hreflangTags.push(tag);
    }

    // Cleanup on unmount or when slug/locale changes
    return () => {
      document.title = previousTitle;

      const injectedDesc = document.querySelector('meta[name="description"][data-cms-seo="true"]');
      if (injectedDesc) injectedDesc.remove();

      const injectedCanonical = document.querySelector('link[rel="canonical"][data-cms-seo="true"]');
      if (injectedCanonical) injectedCanonical.remove();

      hreflangTags.forEach((tag) => tag.remove());
    };
  }, [state, page, locale, slug]);

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state === "not-found") {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">{t("CmsPage.notFound")}</h1>
        <p className="text-muted-foreground">{t("CmsPage.notFoundDescription")}</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">{t("Common.error")}</h1>
        <p className="text-muted-foreground mb-6">{t("CmsPage.loadError")}</p>
        <button
          onClick={fetchPage}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          {t("Common.retry")}
        </button>
      </div>
    );
  }

  // Success state — render sanitized HTML content
  return (
    <div className="container mx-auto px-4 py-8">
      <article className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">{page!.translation.title}</h1>
        <div
          className="prose prose-lg max-w-none
            prose-headings:font-bold prose-headings:text-foreground
            prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4
            prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3
            prose-h4:text-lg prose-h4:mt-4 prose-h4:mb-2
            prose-p:text-base prose-p:leading-7 prose-p:text-foreground/80 prose-p:mb-4
            prose-a:text-primary prose-a:underline hover:prose-a:text-primary/80
            prose-strong:text-foreground prose-strong:font-semibold
            prose-ul:list-disc prose-ul:pl-6 prose-ul:mb-4
            prose-ol:list-decimal prose-ol:pl-6 prose-ol:mb-4
            prose-li:mb-1
            prose-blockquote:border-l-4 prose-blockquote:border-muted prose-blockquote:pl-4 prose-blockquote:italic
            prose-img:rounded-lg prose-img:my-6"
          dangerouslySetInnerHTML={{ __html: page!.translation.content }}
        />
      </article>
    </div>
  );
}
