# UI & UX Improvements

> Specific design and interaction changes needed based on kontakt.az analysis and UX best practices

---

## 1. Header — Restructure to 2-tier

### Current Problem
Single-row header collapses search, nav, and actions into one cramped row. Search is hidden behind an icon — users don't discover it.

### Recommended Change

**Tier 1 (top, smaller):** Logo | Main nav | Phone number | Language switcher  
**Tier 2 (bottom, prominent):** Full-width search bar | Category mega-menu trigger | Action icons (compare, wishlist, cart)

```
Before:  [Logo] [Products] [Categories]  ......  [🔍][🛒][👤][AZ|RU|EN][☰]
After:   [Logo]  [Kampaniyalar] [Mağazalar]  [☎ *XXXX]  [AZ|RU|EN]
         [▦ Kataloq]  [_________ Search products... _________]  [⚖][🤍][🛒]
```

**Impact:** Search discovery goes from ~20% to ~80% of users. Search-driven sessions convert 3× better.

---

## 2. Announcement Bar

### Current Problem
No way to communicate active promotions, free shipping threshold, or time-sensitive campaigns at page load.

### Recommended Change
Full-width colored bar ABOVE the header (not inside it):
- Background: primary brand color or red for urgency
- Text: short campaign message (e.g., "Pulsuz çatdırılma — 50 AZN-dən yuxarı sifarişlərə")
- Optional: dismiss button on right
- Optional: countdown for flash sales

**Files to change:**
- `artifacts/store/src/App.tsx` or main layout wrapper
- New `components/storefront/AnnouncementBar.tsx`

---

## 3. Homepage — Hero Section

### Current Problem
Static gradient background with text. No imagery. No sense of active campaigns. Looks like a placeholder.

### Recommended Changes

**3a. Hero Carousel**
- Slide 1: Main seasonal campaign with full-bleed image
- Slide 2: "Deal of the Day" or brand spotlight
- Auto-advance every 5s with manual dots/arrows
- Slides managed from admin dashboard

**3b. Split Layout Option (alternative to full carousel)**
```
┌─────────────────────────┬──────────────────┐
│                         │  Həftənin        │
│   MAIN HERO BANNER      │  təklifləri      │
│   (campaign image)      │  ─────────────── │
│                         │  [00:15:42]      │
│                         │  Product + price │
│                         │  [Add to Cart]   │
└─────────────────────────┴──────────────────┘
```

**3c. Trust Badge Strip (below hero)**
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ 🚚 Pulsuz   │ 💳 Hissə-    │ 🔄 Asan      │ ✅ Ən yaxşı  │
│ Çatdırılma  │ hissə ödəniş │ Geri qaytarma│ qiymət       │
│ 50 AZN+     │ 0% 12 ay     │ 14 gün       │ zəmanəti     │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

---

## 4. Product Cards — Visual Enhancements

### Current State
Cards show image, title, price. Hover lift is done. Missing several key data points.

### Recommended Changes

**4a. Price display** — show original + sale price when on sale:
```
Before:  199.99 AZN
After:   ~~249.99~~ 199.99 AZN  (-20%)
         from 11.11 AZN/month
```

**4b. Rating stars** — 5 stars + count below product name:
```
★★★★☆  (128)
```

**4c. Quick-add cart button** — appears on hover at card bottom:
```
┌──────────────────────────────┐
│    [Product image w/ zoom]   │
│  Title of product            │
│  ★★★★☆ (42)                  │
│  199.99 AZN                  │
│  ~~~~~~~~ [+ Add to Cart]    │  ← slides up on hover
└──────────────────────────────┘
```

**4d. Badge system** — richer badges:
- `SALE` (red) — already done
- `NEW` (green) — for recently added products
- `HIT` (orange) — for bestsellers
- `0%` (blue) — for installment-eligible items
- Sold out overlay — already done

---

## 5. Product Listing Page — Filter & Sort

### Current Problem
No sort. Filter only has "type" (All/On Sale/Deal). No price, no brand, no rating filter.

### Recommended Layout

```
┌────────────────────┬──────────────────────────────────────────┐
│ FILTERS            │  All Products (124)    Sort by: ▼ Popular │
│ ─────────────────  │  ─────────────────────────────────────────│
│ Price range        │  [Card] [Card] [Card] [Card]              │
│ [    0 — 1000 AZN] │  [Card] [Card] [Card] [Card]              │
│                    │  [Card] [Card] [Card] [Card]              │
│ Brand              │                                           │
│ ☐ Apple            │                        [← 1  2  3 →]      │
│ ☐ Samsung          │                                           │
│ ☐ Xiaomi           │                                           │
│                    │                                           │
│ Rating             │                                           │
│ ★★★★★ and up       │                                           │
│ ★★★★☆ and up       │                                           │
│                    │                                           │
│ Availability       │                                           │
│ ● In stock only    │                                           │
└────────────────────┴──────────────────────────────────────────┘
```

**Sort options:**
- Most Popular (default)
- Price: Low to High
- Price: High to Low
- Newest
- Biggest Discount

---

## 6. Product Detail Page — Information Architecture

### Current Problem
Product detail feels sparse: image + price + stock + qty + add to cart + description + reviews. Missing 60% of information buyers need.

### Recommended Content Structure

```
[Breadcrumb: Home > Category > Subcategory > Product Name]

┌──────────────────────────┬────────────────────────────────┐
│  IMAGE GALLERY           │  Product Name                  │
│  [Main image — zoomable] │  ★★★★☆  (42 reviews)  |  Share │
│  [thumb] [thumb] [thumb] │                                │
│                          │  ~~249.99~~ 199.99 AZN  -20%  │
│                          │  from 11.11 AZN/month (0% 18m) │
│                          │                                │
│                          │  ● In Stock (8 left)           │
│                          │                                │
│                          │  Color: [●Black] [○White]      │
│                          │                                │
│                          │  Qty: [– 1 +]                  │
│                          │  [  🛒 Add to Cart  ]          │
│                          │  [  ♡ Save to Wishlist  ]      │
│                          │                                │
│                          │  🚚 Free delivery on 50+ AZN   │
│                          │  💵 Cash on Delivery           │
│                          │  🔄 14-day returns             │
│                          │  🛡 1 year warranty            │
└──────────────────────────┴────────────────────────────────┘

[Tabs: Description | Specifications | Reviews (42)]

[RELATED PRODUCTS — horizontal scroll]

[RECENTLY VIEWED — horizontal scroll]
```

### Key additions:
- **Strikethrough + discount %** when on sale
- **Installment price** below main price ("from X AZN/month")
- **Image zoom** on hover or click
- **Specifications tab** (key-value table)
- **Delivery/return/warranty info** as icon bullets below CTA
- **Related products** carousel
- **Recently viewed** carousel
- **Review tab** with star breakdown chart

---

## 7. Cart Drawer — Upgrades

### Current Problem
Cart drawer shows items + total. Missing upsell opportunities and urgency signals.

### Recommended Changes

**7a. Free delivery progress bar:**
```
🚚 Add 12.01 AZN more for FREE delivery!
[████████░░░░░░░░░░░░] 37.99 / 50.00 AZN
```

**7b. You might also like** — 2-3 mini product tiles at bottom  
**7c. Promo code field** — visible in cart drawer (not just checkout)  
**7d. Estimated delivery date** — "Arrives: Tomorrow, 22 May"

---

## 8. Footer — Expand to 4 Columns

### Current Problem
Footer has 2 columns with minimal links. Feels unfinished and misses critical trust links.

### Recommended 4-Column Footer Structure

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│  SHOP        │  SUPPORT     │  SERVICES    │  CONTACT     │
│  All Products│  Delivery    │  About Us    │  📞 *XXXX    │
│  Categories  │  Returns     │  Careers     │  📍 Baku, AZ │
│  On Sale     │  Warranty    │  Blog        │              │
│  Deals       │  FAQ         │  For Business│  Follow us:  │
│  Brands      │  Privacy     │  Promo codes │  [FB][IG][TG]│
│  New Arrivals│  Terms       │              │  [YT][WA]    │
├──────────────┴──────────────┴──────────────┴──────────────┤
│  © 2026 Store Name   |   🔒 Secure Shopping   VISA  MC    │
└─────────────────────────────────────────────────────────────┘
```

**New pages needed:** About Us, FAQ, Warranty, Blog (stub), Brands listing

---

## 9. Typography & Spacing

### Issues Observed
- Section headings (h2) are plain and understated — no visual hierarchy vs body text
- Card titles at 14px are hard to scan at a glance
- Price could be larger and bolder on cards

### Recommendations
```
Section heading:  text-2xl font-bold  →  text-2xl font-extrabold tracking-tight
Card title:       text-sm             →  text-[13px] leading-snug (tighter, 2 lines max)
Card price:       text-primary        →  text-primary text-base font-extrabold
Sale price:       -                   →  text-lg font-extrabold text-primary + strikethrough text-muted text-sm
Product heading:  text-2xl md:text-3xl →  text-3xl md:text-4xl font-extrabold
```

---

## 10. Mobile UX Improvements

### Current Issues
- No bottom navigation bar (primary navigation pattern on mobile)
- Search icon too small, not prominent
- Category navigation requires opening a menu — not optimal for browsing

### Recommended Mobile Navigation Bar
```
┌──────────────────────────────────────────┐
│  [🏠 Home] [▦ Catalog] [🔍 Search] [🛒] [👤] │  ← fixed bottom bar
└──────────────────────────────────────────┘
```

---

## 11. Color & Brand Consistency

### Issues
- Store name is "Store" — needs a real brand name + logo
- Primary indigo color is solid but generic
- Category icons use 🛍️ emoji — needs custom icons or at least category-specific emojis
- Red "SALE" badge is correct
- Success messages (green) need standardized icons

### Recommendations
- Set a real store name in `VITE_STORE_NAME`
- Create a small SVG logo
- Use Lucide icons for category tiles instead of emojis
- Establish a red `#E53935` as the accent/sale color (aligns with Azerbaijan market expectations)

---

## 12. Empty States & Error Pages

### Current Issues
- Empty search results: "No products found" — plain text
- 404 page: doesn't exist (falls through to homepage)
- Empty wishlist: no dedicated page

### Recommendations
- Custom illustrated 404 page with "Go to homepage" CTA
- Empty state graphics for: no search results, empty wishlist, empty cart, empty orders
- Search "no results" should suggest popular categories or trending products

---

## Prioritized UI/UX Quick Wins (Can implement in < 1 day each)

| # | Change | File | Time |
|---|---|---|---|
| 1 | Expand search bar to always-visible | Header.tsx | 1h |
| 2 | Add announcement bar component | New AnnouncementBar.tsx | 2h |
| 3 | Add trust badges strip to homepage | HomePage.tsx | 2h |
| 4 | Add sort dropdown to products page | ProductsPage.tsx | 2h |
| 5 | Show strikethrough price on cards | ProductCard.tsx | 1h |
| 6 | Add countdown timer to Deal of Day | HomePage.tsx | 2h |
| 7 | Add free delivery progress bar to cart | CartDrawer.tsx | 2h |
| 8 | Expand footer to 4 columns | New Footer.tsx | 3h |
| 9 | Add image zoom on product detail | ProductDetail.tsx | 2h |
| 10 | Add recently viewed (localStorage) | New RecentlyViewed.tsx | 3h |
