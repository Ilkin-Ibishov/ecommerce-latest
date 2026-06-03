# Bugfix Requirements Document

## Introduction

User-facing text strings in the storefront are hardcoded directly in component JSX instead of being routed through the `t()` translation function from `useI18n()`. This means text remains static in Azerbaijani regardless of the user's selected locale (az/ru/en). The bug affects at least 13 components and pages across the storefront, breaking the multi-language experience for Russian and English-speaking users.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user switches locale to "ru" or "en" THEN the Footer component continues to display hardcoded Azerbaijani text (e.g., "Mağaza", "Məlumat", "Əlaqə", "Bütün hüquqlar qorunur")

1.2 WHEN a user switches locale to "ru" or "en" THEN the CartDrawer component continues to display hardcoded Azerbaijani text (e.g., "Səbət", "Səbətiniz boşdur", "Sifariş ver", "Cəmi", "Promo kodunuz var?", "Tətbiq et", "Pulsuz çatdırılma qazandınız!")

1.3 WHEN a user switches locale to "ru" or "en" THEN the Header component continues to display hardcoded Azerbaijani text (e.g., "Məhsullar", "Kateqoriyalar", "Sifarişlərim", "İstək siyahısı", "Daxil ol", "Çıxış")

1.4 WHEN a user switches locale to "ru" or "en" THEN the TrustBadges component continues to display hardcoded Azerbaijani text (e.g., "Pulsuz Çatdırılma", "Çatdırılmada Ödəniş", "Asan Qaytarma", "Təhlükəsiz Alış-veriş")

1.5 WHEN a user switches locale to "ru" or "en" THEN the ProductDetail component continues to display hardcoded Azerbaijani text (e.g., "Səbətə əlavə et", "Stokda var", "Stokda yoxdur", "Məhsul haqqında", "Rəylər", "Ana səhifə", "Oxşar məhsullar")

1.6 WHEN a user switches locale to "ru" or "en" THEN the ProductCard component continues to display hardcoded Azerbaijani text (e.g., "Stokda yoxdur", installment text "Ayda ... AZN — 12 aya")

1.7 WHEN a user switches locale to "ru" or "en" THEN the MobileBottomNav component continues to display hardcoded Azerbaijani text (e.g., "Ana səhifə", "Məhsullar", "Axtar", "Səbət", "Hesab")

1.8 WHEN a user switches locale to "ru" or "en" THEN the AnnouncementBar component continues to display hardcoded Azerbaijani text (e.g., "100 AZN-dən yuxarı sifarişlərə Pulsuz Çatdırılma · Bütün Azərbaycan üzrə")

1.9 WHEN a user switches locale to "ru" or "en" THEN the RecentlyViewed component continues to display hardcoded Azerbaijani text (e.g., "Son baxılan məhsullar")

1.10 WHEN a user switches locale to "ru" or "en" THEN the CheckoutPage continues to display hardcoded Azerbaijani text (e.g., "Sifariş ver", "Məlumatlarınız", "Çatdırılma ünvanı", "Sifariş icmalı", "Sifariş qəbul edildi!")

1.11 WHEN a user switches locale to "ru" or "en" THEN the ProductsPage continues to display hardcoded Azerbaijani text (e.g., "Bütün məhsullar", "Endirimli məhsullar", "Filtrlər", sort option labels, filter labels)

1.12 WHEN a user switches locale to "ru" or "en" THEN the SearchPage continues to display hardcoded English text (e.g., "Search results for", "results found", "No products found")

1.13 WHEN a user switches locale to "ru" or "en" THEN the WishlistPage continues to display hardcoded English text (e.g., "Your Wishlist", "Sign in to save products", "Browse products")

1.14 WHEN a user switches locale to "ru" or "en" THEN the ProfilePage continues to display hardcoded English text (e.g., "My Profile", "Personal Info", "My Orders", "Sign Out", "No orders yet")

1.15 WHEN a user switches locale to "ru" or "en" THEN the LoginModal continues to display hardcoded English text (e.g., "Sign in with WhatsApp", "Send Code", "Enter verification code", "Verify Code")

### Expected Behavior (Correct)

2.1 WHEN a user switches locale to "ru" or "en" THEN the Footer component SHALL display all user-facing text in the selected locale via the `t()` function

2.2 WHEN a user switches locale to "ru" or "en" THEN the CartDrawer component SHALL display all user-facing text in the selected locale via the `t()` function

2.3 WHEN a user switches locale to "ru" or "en" THEN the Header component SHALL display all user-facing text in the selected locale via the `t()` function

2.4 WHEN a user switches locale to "ru" or "en" THEN the TrustBadges component SHALL display all user-facing text in the selected locale via the `t()` function

2.5 WHEN a user switches locale to "ru" or "en" THEN the ProductDetail component SHALL display all user-facing text in the selected locale via the `t()` function

2.6 WHEN a user switches locale to "ru" or "en" THEN the ProductCard component SHALL display all user-facing text in the selected locale via the `t()` function

2.7 WHEN a user switches locale to "ru" or "en" THEN the MobileBottomNav component SHALL display all user-facing text in the selected locale via the `t()` function

2.8 WHEN a user switches locale to "ru" or "en" THEN the AnnouncementBar component SHALL display all user-facing text in the selected locale via the `t()` function

2.9 WHEN a user switches locale to "ru" or "en" THEN the RecentlyViewed component SHALL display all user-facing text in the selected locale via the `t()` function

2.10 WHEN a user switches locale to "ru" or "en" THEN the CheckoutPage SHALL display all user-facing text in the selected locale via the `t()` function

2.11 WHEN a user switches locale to "ru" or "en" THEN the ProductsPage SHALL display all user-facing text in the selected locale via the `t()` function

2.12 WHEN a user switches locale to "ru" or "en" THEN the SearchPage SHALL display all user-facing text in the selected locale via the `t()` function

2.13 WHEN a user switches locale to "ru" or "en" THEN the WishlistPage SHALL display all user-facing text in the selected locale via the `t()` function

2.14 WHEN a user switches locale to "ru" or "en" THEN the ProfilePage SHALL display all user-facing text in the selected locale via the `t()` function

2.15 WHEN a user switches locale to "ru" or "en" THEN the LoginModal SHALL display all user-facing text in the selected locale via the `t()` function

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the locale is "az" THEN the system SHALL CONTINUE TO display the same Azerbaijani text that currently appears (values move to messages.ts but rendered output is identical)

3.2 WHEN the HeroCarousel component renders with banners from the API THEN it SHALL CONTINUE TO display banner content from the API (title, subtitle, cta_text) without modification since these are dynamic CMS content

3.3 WHEN the HeroCarousel component renders without banners THEN it SHALL CONTINUE TO use the `t()` function for fallback hero text (this component already uses i18n correctly)

3.4 WHEN the PoliciesPage renders THEN it SHALL CONTINUE TO display locale-appropriate content (this page already handles its own multi-locale content via per-locale data objects)

3.5 WHEN product titles and descriptions render THEN the system SHALL CONTINUE TO source them from `product_translations` database records (these are dynamic content, not i18n keys)

3.6 WHEN currency formatting displays "AZN" THEN the system SHALL CONTINUE TO show the currency code as-is (currency codes are not translatable)

3.7 WHEN phone numbers, email addresses, and physical addresses render in the Footer THEN the system SHALL CONTINUE TO display them as literal values (contact info is not translatable text)
