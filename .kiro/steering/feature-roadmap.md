---
inclusion: manual
---

# Feature Roadmap Context

When implementing new features, reference the prioritized roadmap:
#[[file:docs/feature-roadmap.md]]

## Implementation Priority

When the user asks to implement a feature from the roadmap, follow this order:

1. **Check the roadmap** for priority level and effort estimate
2. **Identify affected files** listed in the roadmap entry
3. **Check for DB changes** — if the feature needs new tables/columns, update `supabase/schema.sql` first
4. **API changes** — add/modify routes in `artifacts/api-server/src/routes/`
5. **Frontend changes** — update components/pages in `artifacts/store/src/`
6. **i18n** — add translation keys for all three locales
7. **Test** — verify the feature works end-to-end

## Current P0 Gaps (Critical)

1. ~~Prominent search bar in header~~ ✅ Done (with autocomplete suggestions)
2. ~~Trust badges section on homepage~~ ✅ Done
3. ~~Announcement bar (promo banner)~~ ✅ Done
4. ~~Star ratings on product cards & detail~~ ✅ Done
5. ~~Sort options on products page~~ ✅ Done

## Current P1 Gaps (High Priority)

1. SEO & Open Graph tags (JSON-LD, sitemap, OG)
2. Admin analytics dashboard (revenue chart, KPIs)
3. WhatsApp notification templates (Azerbaijani)
4. Order status tracking page for customers
5. Product image zoom/lightbox on mobile ✅ Done
