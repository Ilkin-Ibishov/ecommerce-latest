# Native Mobile Shopping App (Expo)

## What & Why
Azerbaijan is a mobile-first market — over 75% of e-commerce browsing happens on phones. A native app gives ILK Electronics a permanent home screen presence, faster load times, and a premium feel that mobile browsers can't match. The entire backend API and Supabase database are already production-ready; this creates the Expo/React Native companion app that plugs into them.

## Done looks like
- A new Expo mobile artifact is registered alongside the web store
- The app matches the ILK Electronics brand: yellow primary, dark header, Azerbaijani UI
- Core screens are fully functional: Home (hero banner + categories + featured products), Product List (with filters), Product Detail (image gallery swipe, specs, add-to-cart), Cart drawer (slide-up), Checkout (cash on delivery form), Order confirmation, and Profile (order history)
- Bottom tab navigation: Home · Categories · Search · Cart (badge) · Profile
- Auth: users can sign in with email/password via Supabase (same accounts as web)
- Cart state is in-app only (does not sync with web cart — acceptable for MVP)
- The app runs in the Expo Go preview via the `/mobile` preview path

## Out of scope
- Push notifications (future — needs Expo Push Tokens)
- App Store / Google Play submission
- Deep linking from WhatsApp/web
- Offline mode

## Steps
1. **Scaffold Expo artifact** — Bootstrap a new Expo (React Native) artifact at `artifacts/mobile`; configure it to use the same API base URL and Supabase credentials as the web store; register it in `artifact.toml` with preview path `/mobile`
2. **Navigation shell** — Set up Expo Router with a bottom tab navigator (Home, Categories, Search, Cart, Profile tabs); implement a shared header component with the ILK Electronics logo and cart badge
3. **Home & product listing screens** — Build the Home screen (banner carousel from `/api/banners`, category grid, featured products); build the Products screen with brand/price filters and infinite scroll (page-based)
4. **Product detail screen** — Implement image gallery with swipe gestures, specs accordion, related products horizontal scroll, add-to-cart button with quantity selector, and star rating display
5. **Cart & checkout flow** — Build the cart screen (item list, quantity controls, promo code input, total); build the checkout screen (customer name/phone/address form, cash-on-delivery summary, place order); show order confirmation screen on success
6. **Auth & profile** — Implement email/password sign-in and sign-up screens using Supabase auth; build profile screen showing order history with status badges

## Relevant files
- `artifacts/store/src/lib/api.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifact.toml`
