# Feature Roadmap: What Needs to Be Added

> Based on competitor gap analysis vs kontakt.az | Priority: High / Medium / Low

---

## Priority Matrix

```
HIGH IMPACT + LOW EFFORT   →  Do first (Quick wins)
HIGH IMPACT + HIGH EFFORT  →  Plan carefully (Big bets)
LOW IMPACT + LOW EFFORT    →  Do when time allows
LOW IMPACT + HIGH EFFORT   →  Skip or defer
```

---

## 🔴 P0 — Critical Gaps (Do First)

These are features that directly lose customers or revenue today.

### 1. Prominent Search Bar
**Impact:** High — search is the primary product discovery path  
**Effort:** Low  
**What:** Replace the search icon with a visible, full-width search input in the header  
**Files:** `artifacts/store/src/components/storefront/Header.tsx`

### 2. Trust Badges Section on Homepage
**Impact:** High — increases purchase confidence, especially for cash-on-delivery  
**Effort:** Low  
**What:** 4-badge row below hero: Free Delivery threshold · Cash on Delivery · Easy Returns · Secure Shopping  
**Files:** `artifacts/store/src/pages/storefront/HomePage.tsx`

### 3. Announcement Bar (Promo Banner)
**Impact:** High — drives urgency and communicates active promotions  
**Effort:** Low  
**What:** Dismissible sticky bar above header: current sale/campaign text + CTA link  
**Files:** `artifacts/store/src/components/storefront/Header.tsx`, new `AnnouncementBar.tsx`

### 4. Star Ratings on Product Cards & Detail
**Impact:** High — social proof is critical for conversion  
**Effort:** Medium  
**What:** 1–5 star field in comments table; average rating + count shown on ProductCard and ProductDetail  
**Files:** `artifacts/store/src/components/storefront/ProductCard.tsx`, `ProductDetail.tsx`  
**DB:** Add `rating` (int 1–5) column to `product_comments` table

### 5. Sort Options on Products Page
**Impact:** High — users expect to sort by price, popularity, newest  
**Effort:** Low  
**What:** Sort dropdown: Newest · Price: Low to High · Price: High to Low · Most Popular  
**Files:** `artifacts/store/src/pages/storefront/ProductsPage.tsx`

---

## 🟠 P1 — High Value (This Quarter)

### 6. Installment/Monthly Payment Info Display
**Impact:** High — "0% 24 ay" is a huge conversion driver in Azerbaijan market  
**Effort:** Medium  
**What:** Show "from X AZN/month" below price on product cards and detail page; link to payment info page  
**Note:** Even if actual installment isn't implemented yet, showing the messaging is enough to build trust  
**Files:** `ProductCard.tsx`, `ProductDetail.tsx`

### 7. Price Range & Brand Filters
**Impact:** High — users can't narrow down without filters  
**Effort:** Medium  
**What:** Add to filter sidebar: price range slider, brand multi-select checkboxes, rating filter  
**Files:** `artifacts/store/src/pages/storefront/ProductsPage.tsx`

### 8. Product Specifications Table
**Impact:** High — users won't buy electronics without specs  
**Effort:** Medium  
**What:** `product_specs` table (key/value pairs); displayed as a formatted table on product detail  
**Files:** `ProductDetail.tsx`  
**DB:** New `product_specs` table: `(id, product_id, key, value, sort_order)`

### 9. Related/Similar Products Section
**Impact:** High — increases average order value and time on site  
**Effort:** Medium  
**What:** Show 4 products from same category at bottom of ProductDetail  
**Files:** `artifacts/store/src/components/storefront/ProductDetail.tsx`  
**API:** `GET /products/:id/related`

### 10. Brand Logos Section on Homepage
**Impact:** Medium-High — builds legitimacy with recognized brands  
**Effort:** Low  
**What:** Horizontal scrolling brand logo strip between hero and categories  
**Files:** `artifacts/store/src/pages/storefront/HomePage.tsx`  
**DB:** New `brands` table or add `brand` field to `products`

### 11. Quick Add to Cart on Product Cards
**Impact:** High — reduces friction for repeat/impulse purchases  
**Effort:** Medium  
**What:** Cart icon appears on product card hover; clicking adds qty 1 directly to cart without leaving the page  
**Files:** `artifacts/store/src/components/storefront/ProductCard.tsx`

---

## 🟡 P2 — Medium Value (Next Quarter)

### 12. Product Comparison Tool
**Impact:** Medium — useful for electronics buyers comparing specs  
**Effort:** High  
**What:** Checkbox on each product card; floating comparison bar at bottom; full comparison table page  
**Files:** New `CompareBar.tsx`, `ComparePage.tsx`

### 13. Hero Banner Carousel
**Impact:** Medium — more professional, drives campaign awareness  
**Effort:** Medium  
**What:** Replace static hero with auto-playing carousel; slides managed from admin dashboard  
**DB:** New `banners` table: `(id, title, subtitle, image_url, cta_text, cta_url, sort_order, active)`  
**Files:** New `HeroCarousel.tsx`, admin banner management page

### 14. Countdown Timer for Deals
**Impact:** Medium — urgency drives conversion on deal of day  
**Effort:** Low  
**What:** Add countdown timer to the "Deal of the Day" card (count down to midnight)  
**Files:** `artifacts/store/src/pages/storefront/HomePage.tsx`

### 15. Recently Viewed Products
**Impact:** Medium — reduces bounce rate, helps users return to products  
**Effort:** Low  
**What:** Store last 8 viewed products in localStorage; show horizontal carousel at bottom of product pages  
**Files:** New `RecentlyViewed.tsx`

### 16. Free Delivery Threshold Messaging
**Impact:** Medium — nudges cart value up  
**Effort:** Low  
**What:** In cart drawer: "Add X more AZN for free delivery"; show threshold prominently on homepage  
**Files:** `artifacts/store/src/components/storefront/CartDrawer.tsx`

### 17. Image Zoom on Product Detail
**Impact:** Medium — critical for product detail confidence  
**Effort:** Low  
**What:** Cursor magnifier / lightbox expand on main product image click  
**Files:** `artifacts/store/src/components/storefront/ProductDetail.tsx`

### 18. Promo Code Enhancements
**Impact:** Medium — promo codes exist but aren't marketed  
**Effort:** Low  
**What:** Show "Have a promo code?" prominently in cart; add codes page listing active promotions  
**Files:** `CartDrawer.tsx`, new `PromosPage.tsx`

---

## 🟢 P3 — Nice to Have (Future)

### 19. Loyalty/Points Program
**Impact:** Medium — increases repeat purchase rate  
**Effort:** Very High  
**What:** Points earned per purchase, redeemable on next order  
**DB:** `loyalty_points` table, points_earned on orders

### 20. Wishlist Sharing
**Impact:** Low  
**Effort:** Low  
**What:** Share wishlist via link  

### 21. Product Q&A Section
**Impact:** Low-Medium  
**Effort:** Medium  
**What:** Users can ask questions; admin or community answers; shown on product page

### 22. Order Tracking Page with Timeline
**Impact:** Medium  
**Effort:** Medium  
**What:** Visual timeline on order detail: Placed → Confirmed → In Delivery → Delivered  
**Files:** `artifacts/store/src/pages/storefront/ProfilePage.tsx`

### 23. Email/WhatsApp Order Notifications
**Impact:** Medium  
**Effort:** High  
**What:** Automated WhatsApp message on order placement via Twilio/WhatsApp Business API

### 24. Blog / Content Pages
**Impact:** Low (SEO long-term)  
**Effort:** High  
**What:** CMS-lite blog with product guides; managed from admin

### 25. Corporate/B2B Sales Form
**Impact:** Low-Medium for B2B segment  
**Effort:** Medium  
**What:** Dedicated corporate landing page with bulk order enquiry form

---

## Summary Table

| # | Feature | Priority | Impact | Effort |
|---|---|---|---|---|
| 1 | Prominent search bar | P0 | 🔴 High | Low |
| 2 | Trust badges section | P0 | 🔴 High | Low |
| 3 | Announcement bar | P0 | 🔴 High | Low |
| 4 | Star ratings | P0 | 🔴 High | Medium |
| 5 | Sort options | P0 | 🔴 High | Low |
| 6 | Installment messaging | P1 | 🟠 High | Medium |
| 7 | Price + brand filters | P1 | 🟠 High | Medium |
| 8 | Product specs table | P1 | 🟠 High | Medium |
| 9 | Related products | P1 | 🟠 High | Medium |
| 10 | Brand logos | P1 | 🟠 Medium | Low |
| 11 | Quick add to cart | P1 | 🟠 High | Medium |
| 12 | Product comparison | P2 | 🟡 Medium | High |
| 13 | Hero carousel | P2 | 🟡 Medium | Medium |
| 14 | Countdown timer | P2 | 🟡 Medium | Low |
| 15 | Recently viewed | P2 | 🟡 Medium | Low |
| 16 | Delivery threshold msg | P2 | 🟡 Medium | Low |
| 17 | Image zoom | P2 | 🟡 Medium | Low |
| 18 | Promo code enhancements | P2 | 🟡 Medium | Low |
| 19 | Loyalty program | P3 | 🟢 Medium | Very High |
| 20-25 | Various | P3 | 🟢 Low | Various |
