# User Profile Page Enhancements

## What & Why
Improve the profile page with editable user info, a saved default delivery address, and a richer order detail view. Currently the page only shows order history and a sign-out button — users have no way to set their name or save an address, and order cards lack re-order capability.

## Done looks like
- Users can edit their full name and see their phone number on the profile page
- Users can save a default delivery address (pre-fills checkout automatically)
- Order cards show a visual status timeline (pending → confirmed → shipped → delivered) and a re-order button that adds all items back to cart
- All changes persist immediately (optimistic UI + API save)
- Profile page reflects the user's saved name in the header/greeting

## Out of scope
- Multiple saved addresses / address book
- Email editing (phone is the primary identity; email is internal shadow)
- Loyalty points or referral features
- Full layout redesign / tab restructure

## Steps

1. **Database: add default_address to users table** — Add a `default_address` text column to the `public.users` table via a Supabase migration SQL file. No new table needed; a single nullable column covers the use case.

2. **API: profile GET and PATCH routes** — Add `GET /profile` (returns `full_name`, `phone`, `default_address`) and `PATCH /profile` (updates `full_name` and/or `default_address`) routes in `api-server`. Both routes require an authenticated session token.

3. **Store: useProfile hook** — Create a `useProfile` hook in the store that fetches from `GET /profile` and exposes an `updateProfile` mutation. This centralises auth+profile data access and avoids duplicating Supabase calls across components.

4. **Profile page: Edit Info section** — Add an inline-editable section at the top of `ProfilePage.tsx` showing the user's phone (read-only) and full name (editable text field with a save button). Wire to `useProfile`.

5. **Profile page: Default Address section** — Add a "Default Delivery Address" card below the info section with an editable textarea. On save, calls `PATCH /profile`. Checkout should read this saved address to pre-fill the delivery address field.

6. **Profile page: Enhanced order cards** — Update `OrderCard` to show a horizontal status stepper (Pending → Confirmed → Shipped → Delivered) and a "Re-order" button that adds all order items to the cart via the existing `useCart` hook.

## Relevant files
- `artifacts/store/src/pages/storefront/ProfilePage.tsx`
- `artifacts/store/src/pages/storefront/CheckoutPage.tsx`
- `artifacts/api-server/src/routes/orders.ts`
- `artifacts/api-server/src/routes/auth.ts`
- `supabase/schema.sql`
- `lib/db/src/schema/index.ts`
