---
inclusion: manual
---

# SEO Implementation Guide

This store is a React SPA — Googlebot cannot execute client-side JavaScript reliably. SEO strategy must account for this.

## Current State

- No per-page meta tags, no structured data, no sitemap
- Sharing product links on WhatsApp/Telegram shows blank previews
- Competitor kontakt.az has full SEO implementation

## SPA SEO Strategy

Since the storefront is a Vite React SPA (client-rendered), SEO requires:
1. **API-served routes** for `/sitemap.xml` and `/robots.txt` (Express endpoints)
2. **Client-side meta injection** via `document.title` + dynamic `<meta>` tags
3. **JSON-LD structured data** injected as `<script type="application/ld+json">` blocks
4. **Open Graph tags** for social sharing previews

## Required Schema Types

| Page | Schema | Key Properties |
|------|--------|---------------|
| Product | `Product` | name, image, offers (price, currency, availability), brand |
| Category | `ItemList` | itemListElement[] |
| Home | `WebSite` + `Organization` | name, url, logo |

## Meta Tag Pattern

```tsx
// usePageMeta hook pattern
function usePageMeta(title: string, description: string, image?: string) {
  useEffect(() => {
    document.title = title;
    // Update/create meta tags dynamically
  }, [title, description, image]);
}
```

## Sitemap

Express endpoint at `GET /api/sitemap.xml` that queries all products and categories from Supabase and returns valid XML. Reference from robots.txt.

## Open Graph

Required for WhatsApp/Telegram previews:
- `og:title`, `og:description`, `og:image`, `og:url`, `og:type`
- Product images from Supabase Storage as `og:image`
