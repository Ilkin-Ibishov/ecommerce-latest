# SEO & Open Graph Optimization

## What & Why
The store currently has no per-page meta tags, no structured data, and no sitemap. Search engines index it poorly, and sharing a product link on WhatsApp or social media shows a blank preview. For an Azerbaijan electronics store competing on Google.az, this is a critical gap — competitor Kontakt.az has full SEO. This adds dynamic meta tags, Open Graph images, structured data (Product schema), and a sitemap.

## Done looks like
- Each product page has a unique `<title>` (product name + brand + "| ILK Electronics"), `<meta name="description">`, and Open Graph tags (`og:title`, `og:description`, `og:image` from product image)
- Sharing a product link on WhatsApp/Telegram shows the product image, name, and price in the preview card
- Google can read product structured data (JSON-LD `Product` schema with price, availability, brand, image)
- Home page, category pages, and product listing pages have relevant title + description tags
- A `/sitemap.xml` endpoint serves all public URLs (products, categories) for search engine crawling
- A `/robots.txt` is served correctly allowing all crawlers

## Out of scope
- Paid search / Google Shopping feed (separate task)
- Multilingual hreflang tags (az/ru/en) — future
- Image CDN / next-gen image optimization

## Steps
1. **Head management utility** — Add a lightweight `usePageMeta(title, description, image?)` hook using `document.title` + dynamic `<meta>` injection (or integrate `react-helmet-async` if already available); call it from each storefront page
2. **Product page SEO** — In `ProductPage`, set title to `{productName} — {brand} | ILK Electronics`, description from the product's Azerbaijani description (truncated to 155 chars), and OG image from the first product image
3. **Listing & category page SEO** — Set relevant titles for HomePage ("Elektronika mağazası — ILK Electronics"), ProductsPage, CategoryPage, and CategoriesPage
4. **Structured data** — Inject a JSON-LD `<script type="application/ld+json">` block on each ProductPage with `@type: Product`, name, image, offers (price, currency, availability), brand — improves Google rich results
5. **Sitemap & robots** — Add a `GET /sitemap.xml` API route that queries Supabase for all products and categories and returns a valid XML sitemap; add `GET /robots.txt` route; link sitemap URL from robots.txt

## Relevant files
- `artifacts/store/src/pages/storefront/ProductPage.tsx`
- `artifacts/store/src/pages/storefront/ProductsPage.tsx`
- `artifacts/store/src/pages/storefront/CategoryPage.tsx`
- `artifacts/store/src/pages/storefront/HomePage.tsx`
- `artifacts/api-server/src/routes/index.ts`
