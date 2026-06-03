---
inclusion: manual
---

# E-Commerce Playbooks

Reference playbooks for common ecommerce tasks. These are adapted from specialized skill libraries.

## Competitive Analysis (vs kontakt.az)

When analyzing competitors:
1. Check their pricing pages, product structure, and feature set
2. Use App Store / Play Store for mobile app comparison
3. Build a feature comparison matrix (rows = capabilities, columns = competitors)
4. Identify white space — features they lack that we can exploit
5. Reference: `docs/feature-roadmap.md` for the existing gap analysis

## SEO for E-Commerce SPAs

Key challenges for this React SPA store:
- Googlebot doesn't reliably execute JS — meta tags must be in initial HTML or injected client-side
- Product pages need JSON-LD `Product` schema for rich results
- Category pages need `ItemList` schema
- Sitemap must be server-rendered (Express route)
- OG tags critical for WhatsApp/Telegram sharing in Azerbaijan market

Priority: sitemap.xml → robots.txt → product schema → OG tags → meta descriptions

## Content & Marketing

For the Azerbaijan market:
- Primary language: Azerbaijani (az)
- Secondary: Russian (ru), English (en)
- WhatsApp is the dominant messaging platform
- Cash-on-delivery is the primary payment method
- Trust signals (badges, reviews, brand logos) are critical for conversion
- "0% taksit" (installment) messaging is a major conversion driver

## Product Management (RICE Prioritization)

When prioritizing features from the roadmap:
- **Reach:** Users affected per quarter (use order volume as proxy)
- **Impact:** 3=massive, 2=high, 1=medium, 0.5=low
- **Confidence:** 100%=data-backed, 80%=strong intuition, 50%=guessing
- **Effort:** Person-weeks (PM + design + eng)
- Score = (R × I × C) / E

## Supplier Research

For product sourcing (electronics):
- Primary sources: Alibaba (China), Global Sources (Asia audited)
- Verification: ImportYeti for customs data cross-check
- Key: verify factory is real (not trading company)
- Azerbaijan import considerations: customs duties, shipping time from China (~30 days sea freight)
