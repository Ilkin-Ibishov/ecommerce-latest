# Checkout & Validation Bugs — Bugfix Design

## Overview

This design addresses 8 categories of validation, UX, and image-loading bugs discovered across the white-label e-commerce platform. The bugs collectively allow unbounded input (DoS vector), produce silent failures (no user feedback), enable duplicate submissions, break all product images via ORB blocking, leave admin forms unprotected, skip localization for error messages, and display redundant loading text. The fix strategy is minimal and targeted: add `maxlength` attributes and Zod `.max()` limits, surface inline error messages via `t()`, add loading/disabled states on submit buttons, replace the wsrv.nl proxy with direct Supabase Storage URLs, add `validate()` middleware to the categories route, extend InlineEditor with `maxLength` support, and remove redundant loading text labels.

## Glossary

- **Bug_Condition (C)**: The set of inputs or states that trigger the defective behavior — oversized fields, empty required fields, rapid clicks, ORB-blocked images, unvalidated admin payloads, hardcoded strings, redundant loading text
- **Property (P)**: The desired correct behavior when C holds — rejection with 400, inline error display, single API call, images visible, localized messages, clean loading UI
- **Preservation**: Existing behaviors that must remain unchanged — valid form submission, correct cart math, single-click order flow, image rendering when CDN works, valid admin CRUD, profile/comment creation within limits
- **`validate(schema)`**: Express middleware in `src/middlewares/validate.ts` that runs `schema.safeParse(req.body)` and returns 400 on failure
- **`t(key)`**: i18n translation function from `useI18n()` that resolves localized strings across az/ru/en locales
- **`getProxyUrl()`**: Function in `artifacts/store/src/lib/image-proxy.ts` that builds wsrv.nl CDN URLs for image optimization
- **InlineEditor**: Reusable profile editing component at `components/storefront/profile/InlineEditor.tsx`
- **BouncingLoader**: Loading animation component at `components/ui/BouncingLoader.tsx` that accepts an optional `label` prop

## Bug Details

### Bug Condition

The bugs manifest across 8 distinct conditions that share a common theme: missing input boundaries and missing user feedback. The checkout form accepts unlimited text, shows no errors on empty submission, fires duplicate requests on rapid clicks, images fail via ORB blocking, admin routes lack validation middleware, profile/comments accept unbounded strings, error messages are hardcoded in English, and loading animations show redundant text.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type PlatformInteraction
  OUTPUT: boolean
  
  RETURN isBugCondition_Length(input)
      OR isBugCondition_EmptyFields(input)
      OR isBugCondition_RapidClicks(input)
      OR isBugCondition_ImageLoad(input)
      OR isBugCondition_AdminLength(input)
      OR isBugCondition_ProfileCommentLength(input)
      OR isBugCondition_HardcodedString(input)
      OR isBugCondition_RedundantLoadingText(input)
END FUNCTION

FUNCTION isBugCondition_Length(X)
  INPUT: X of type CheckoutFormInput
  OUTPUT: boolean
  RETURN X.customer_name.length > 100
      OR X.delivery_address.length > 500
      OR X.notes.length > 1000
      OR X.coupon_code.length > 50
      OR X.customer_phone.length > 20
END FUNCTION

FUNCTION isBugCondition_EmptyFields(X)
  INPUT: X of type CheckoutFormInput
  OUTPUT: boolean
  RETURN X.customer_name.trim() = ""
      OR X.customer_phone.trim() = ""
      OR X.delivery_address.trim() = ""
END FUNCTION

FUNCTION isBugCondition_RapidClicks(X)
  INPUT: X of type SubmitSequence
  OUTPUT: boolean
  RETURN X.clickCount > 1
     AND X.timeBetweenClicks < 1000ms
     AND X.buttonNotDisabled = true
END FUNCTION

FUNCTION isBugCondition_ImageLoad(X)
  INPUT: X of type ImageRequest
  OUTPUT: boolean
  RETURN X.proxyUrl.contains("wsrv.nl")
     AND browser_blocks_response_via_ORB(X)
END FUNCTION

FUNCTION isBugCondition_AdminLength(X)
  INPUT: X of type AdminFormInput
  OUTPUT: boolean
  RETURN (X.route = "/admin/categories" AND NO validate() middleware applied)
      OR (X.route IN ["/admin/products", "/admin/coupons", "/admin/banners"]
          AND any_string_field_exceeds_max(X))
END FUNCTION

FUNCTION isBugCondition_ProfileCommentLength(X)
  INPUT: X of type UserInput
  OUTPUT: boolean
  RETURN (X.route = "/profile" AND (X.full_name.length > 100 OR X.default_address.length > 500))
      OR (X.route = "/products/:id/comments" AND X.content.length > 2000)
END FUNCTION

FUNCTION isBugCondition_HardcodedString(X)
  INPUT: X of type UIComponent
  OUTPUT: boolean
  RETURN X.displaysErrorMessage = true
     AND X.errorMessageSource = "hardcoded_literal"
     AND X.locale != "en"
END FUNCTION

FUNCTION isBugCondition_RedundantLoadingText(X)
  INPUT: X of type PageLoadState
  OUTPUT: boolean
  RETURN X.hasLoadingAnimation = true
     AND X.hasLoadingText = true
END FUNCTION
```

### Examples

- **Length overflow**: User types a 5000-character string into the Name field → currently accepted; should be blocked at 100 chars client-side and rejected with 400 server-side
- **Silent validation**: User clicks "Place Order" with empty name/phone/address → currently nothing happens (silent return); should show inline error messages below each empty field
- **Duplicate submission**: User clicks submit 5 times in 500ms → currently fires 5 POST /api/orders; should fire exactly 1 and disable the button
- **Image ORB blocking**: Browser requests `https://wsrv.nl/?url=...` → response blocked by Cross-Origin Read Blocking; should load images via direct Supabase Storage public URLs or show placeholder
- **Admin no validation**: POST `/admin/categories` with 10,000-char slug → currently stored in DB; should be rejected with 400
- **Profile overflow**: PATCH `/profile` with 50,000-char `full_name` → currently stored; should reject with 400
- **Hardcoded English**: Non-English user triggers banner validation → sees "Title is required." in English; should see localized message via `t()`
- **Redundant text**: HomePage loading → shows bouncing animation AND "Yüklənir…" text; should show only the animation

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Valid checkout form submissions (all fields within limits, non-empty required fields) continue to place orders successfully
- Single-click submissions with valid data fire exactly one API request and complete the order flow
- Cart math (subtotals, discounts, totals) remains correct
- Product images display at correct preset resolutions (300×300 thumbnail, 1000×1000 gallery, 1600×1600 lightbox) when the delivery mechanism works
- Phone number normalization (994 prefix handling) continues as before
- Coupon validation and discount application work for valid codes within length limits
- Unauthenticated users see the login modal instead of form submission
- Valid admin CRUD operations (categories, products, coupons, banners) continue to succeed
- Valid profile updates (full_name ≤100, default_address ≤500) save correctly
- Valid comments (content ≤2000, rating 1–5) create in pending/unapproved state
- Loading animations continue to display during page loads (only text removed, not the visual spinner)

**Scope:**
All inputs that are within the new length limits, have required fields filled, represent single submissions, and use the new image delivery mechanism should behave identically to pre-fix behavior.

## Hypothesized Root Cause

Based on the bug analysis and code inspection, the root causes are:

1. **Missing `maxlength` attributes (Client)**: The `CheckoutPage` `Field` component and admin form inputs do not pass `maxLength` to the underlying `<input>`/`<textarea>` elements. The `InlineEditor` component also lacks `maxLength` prop support.

2. **Missing Zod `.max()` limits (Server)**: The `/api/orders` endpoint validates presence (`!customer_name`) but not length. The admin `schemas.ts` defines `z.string()` without `.max()` on text fields. The categories route has zero `validate()` middleware. The profile and comments routes have no length checking.

3. **No submit button loading state**: The checkout `handleSubmit` sets `loading=true` and the button has `disabled={loading}`, but there's no guard against the function being called multiple times before the first `setLoading(true)` takes effect (React batching). Additionally, rapid clicks can queue multiple events before the disabled prop renders.

4. **wsrv.nl ORB blocking**: The wsrv.nl CDN proxy serves image responses with incorrect or missing `Content-Type` headers, causing browsers to apply Cross-Origin Read Blocking. The `getProxyUrl()` function constructs these URLs which are then used directly in `<img src>` tags.

5. **No categories validation**: `routes/admin/categories.ts` directly destructures `req.body` with no `validate()` middleware call — the only admin write route without it.

6. **Hardcoded error strings**: `BannersPage.tsx` line 80 uses `setError("Title is required.")` instead of `setError(t("Admin.bannerTitleRequired"))`.

7. **BouncingLoader `label` prop usage**: Pages pass a `label` string to `BouncingLoader`, which renders text below the animation. The animation alone sufficiently communicates loading state.

## Correctness Properties

Property 1: Bug Condition - Checkout Length Validation

_For any_ checkout form input where any text field exceeds its maximum length (customer_name > 100, delivery_address > 500, notes > 1000, coupon_code > 50, customer_phone > 20), the fixed system SHALL prevent client-side entry beyond the limit via `maxlength` AND reject the server-side request with HTTP 400.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.4b, 2.5**

Property 2: Bug Condition - Empty Field Error Messages

_For any_ checkout form submission where a required field (customer_name, customer_phone, delivery_address) is empty or whitespace-only, the fixed system SHALL display a localized inline error message below the invalid field, highlight the field border, and prevent the API request from being fired.

**Validates: Requirements 2.6**

Property 3: Bug Condition - Submit Button Debouncing

_For any_ sequence of rapid clicks (more than 1 click within 1000ms) on the checkout submit button, the fixed system SHALL fire exactly one API request, disable the button after the first click, show a loading state, and re-enable after completion.

**Validates: Requirements 2.7, 2.8, 2.8b**

Property 4: Bug Condition - Image Loading via Non-ORB Mechanism

_For any_ product image that was previously loaded via wsrv.nl proxy and blocked by ORB, the fixed system SHALL load the image via a mechanism that does not trigger ORB blocking (direct Supabase Storage public URLs or alternative CDN), and SHALL display a placeholder on failure.

**Validates: Requirements 2.9, 2.10**

Property 5: Bug Condition - Admin Form Server-Side Validation

_For any_ admin form submission where text fields exceed defined limits (categories: slug>100, icon_url>500, title>200; products: sku>50, slug>100, brand>100; coupons: code>50, description>500; banners: title>200, subtitle>500, cta_text>100, cta_url>500), the fixed system SHALL reject the request with HTTP 400.

**Validates: Requirements 2.11, 2.15, 2.16, 2.17**

Property 6: Bug Condition - Profile & Comments Length Validation

_For any_ profile update where full_name exceeds 100 chars or default_address exceeds 500 chars, OR any comment where content exceeds 2000 chars, the fixed system SHALL reject the request with HTTP 400.

**Validates: Requirements 2.20, 2.21**

Property 7: Bug Condition - Localized Error Messages

_For any_ form validation error displayed to a non-English user, the fixed system SHALL use `t()` for all error messages, producing locale-appropriate text instead of hardcoded English strings.

**Validates: Requirements 2.13, 2.14, 2.18**

Property 8: Preservation - Valid Inputs Unchanged

_For any_ input where the bug condition does NOT hold (all fields within limits, required fields filled, single submission, images via new mechanism, valid admin payloads), the fixed system SHALL produce the same result as the original system, preserving all existing functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15**

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15**

## Fix Implementation

### Changes Required

#### 1. Checkout Form — Client-Side Length Enforcement

**File**: `artifacts/store/src/pages/storefront/CheckoutPage.tsx`

**Specific Changes**:
1. **Add `maxLength` prop to Field component**: Extend the `Field` function to accept and pass through `maxLength`
2. **Set limits on inputs**: customer_name (100), customer_phone (20), delivery_address (500), coupon_code (50)
3. **Set `maxLength` on notes textarea**: 1000 characters
4. **Add submit-in-progress ref guard**: Use a `useRef(false)` to prevent re-entry of `handleSubmit` even before React re-renders the disabled button state

#### 2. Checkout Form — Server-Side Length Validation

**File**: `artifacts/api-server/src/routes/orders.ts`

**Specific Changes**:
1. **Create `CreateOrderSchema`**: Zod schema with `customer_name: z.string().max(100)`, `customer_phone: z.string().max(20)`, `delivery_address: z.string().max(500)`, `notes: z.string().max(1000).optional()`, `coupon_code: z.string().max(50).optional()`, `items: z.array(...)`
2. **Add `validate(CreateOrderSchema)` middleware** to the POST `/orders` route
3. **Use `req.validatedBody`** instead of raw `req.body` destructuring

#### 3. Image Loading — Replace wsrv.nl Proxy

**File**: `artifacts/store/src/lib/image-proxy.ts`

**Specific Changes**:
1. **Replace `getProxyUrl` implementation**: Return Supabase Storage public URLs directly (since they're already public and accessible)
2. **Add `getPlaceholderUrl()` helper**: Returns a data URI or static asset path for broken image fallback
3. **Update image components**: Add `onError` handler that sets `src` to placeholder instead of attempting another blocked URL

#### 4. Admin Categories — Add Validation Middleware

**File**: `artifacts/api-server/src/routes/admin/categories.ts`

**Specific Changes**:
1. **Create `CreateCategorySchema` and `UpdateCategorySchema`** in `routes/admin/schemas.ts`: slug (max 100), icon_url (max 500, optional), parent_id (optional), translations array with title (max 200)
2. **Add `validate()` middleware** to both POST and PATCH routes
3. **Use `req.validatedBody`** for body destructuring

#### 5. Admin Schemas — Add `.max()` Limits

**File**: `artifacts/api-server/src/routes/admin/schemas.ts`

**Specific Changes**:
1. **Products**: Add `.max()` to `sku` (50), `slug` (100), `brand` (100), `ProductTranslation.title` (200), `ProductTranslation.description` (5000), `ProductSpec.spec_key` (100), `ProductSpec.spec_value` (500)
2. **Coupons**: Add `.max(50)` to `code`, `.max(500)` to `description`
3. **Banners**: Add `.max(200)` to `title`, `.max(500)` to `subtitle`, `.max(100)` to `cta_text`, `.max(500)` to `cta_url`

#### 6. Admin Forms — Client-Side maxLength + Error Messages

**Files**: `pages/admin/BannersPage.tsx`, `pages/admin/CategoriesPage.tsx` (or equivalent), `pages/admin/ProductFormPage.tsx`

**Specific Changes**:
1. **Add `maxLength` to all text inputs** per the limits defined above
2. **Replace hardcoded `"Title is required."` in BannersPage** with `t("Admin.bannerTitleRequired")`
3. **Add i18n keys** to all three locale files (az/ru/en)
4. **Add inline error display** for empty required fields using `t()` in categories and product forms

#### 7. Profile & Comments — Server-Side Validation

**File**: `artifacts/api-server/src/routes/profile.ts`

**Specific Changes**:
1. **Create `UpdateProfileSchema`**: `full_name: z.string().max(100).nullable().optional()`, `default_address: z.string().max(500).nullable().optional()`
2. **Add `validate(UpdateProfileSchema)` middleware** to PATCH `/profile`

**File**: `artifacts/api-server/src/routes/comments.ts`

**Specific Changes**:
1. **Create `CreateCommentSchema`**: `content: z.string().min(1).max(2000)`, `rating: z.number().int().min(1).max(5).optional()`
2. **Add `validate(CreateCommentSchema)` middleware** to POST `/products/:productId/comments`

#### 8. InlineEditor — maxLength Support

**File**: `artifacts/store/src/components/storefront/profile/InlineEditor.tsx`

**Specific Changes**:
1. **Add `maxLength` to props interface**: `maxLength?: number`
2. **Pass `maxLength` to both `<input>` and `<textarea>` elements**

#### 9. Loading Text Removal

**Files**: `pages/storefront/HomePage.tsx`, `pages/storefront/ProductsPage.tsx`, and any other pages using `BouncingLoader` with `label`

**Specific Changes**:
1. **Remove `label` prop** from all `BouncingLoader` usages
2. **Keep the animation itself** unchanged

#### 10. Admin Button Loading States

**Files**: `pages/storefront/WishlistPage.tsx`, `pages/admin/CouponsPage.tsx`

**Specific Changes**:
1. **Add per-item loading state** (e.g., `loadingId` state) to prevent duplicate API calls on remove/toggle/delete buttons
2. **Disable the button** while the API call is in-flight
3. **Re-enable on completion** (success or failure)

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that submit oversized payloads to API endpoints, attempt form submission with empty fields, simulate rapid button clicks, and verify image URL generation. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Oversized Checkout Fields Test**: POST `/api/orders` with 5000-char customer_name → currently 201 (will fail on unfixed code to demonstrate acceptance of oversized input)
2. **Empty Field Submission Test**: Render CheckoutPage, click submit with empty fields → currently no error messages visible (will demonstrate silent failure)
3. **Rapid Click Test**: Click submit 5 times rapidly → currently fires 5 requests (will demonstrate duplicate submissions)
4. **Image ORB Test**: Load a product page with wsrv.nl proxy URLs → images fail to render (demonstrates ORB blocking)
5. **Categories No Validation Test**: POST `/admin/categories` with 10,000-char slug → currently 201 (demonstrates missing validation)
6. **Profile Overflow Test**: PATCH `/profile` with 50,000-char full_name → currently 200 (demonstrates missing length check)

**Expected Counterexamples**:
- API accepts arbitrarily long strings without rejection
- Form submits silently with no visual feedback on empty fields
- Multiple API requests fire on rapid clicks
- Possible causes: missing `maxlength` attrs, missing Zod `.max()`, missing `validate()` middleware, no submit guard

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition_Length(X) DO
  result := submitCheckout'(X)
  ASSERT result.status = 400
     AND result.body.error contains length information
END FOR

FOR ALL X WHERE isBugCondition_EmptyFields(X) DO
  result := renderAndSubmit'(X)
  ASSERT result.errorsDisplayed = true
     AND result.apiRequestFired = false
END FOR

FOR ALL X WHERE isBugCondition_RapidClicks(X) DO
  result := handleMultipleClicks'(X)
  ASSERT result.apiRequestCount = 1
END FOR

FOR ALL X WHERE isBugCondition_AdminLength(X) DO
  result := submitAdmin'(X)
  ASSERT result.status = 400
END FOR

FOR ALL X WHERE isBugCondition_ProfileCommentLength(X) DO
  result := submitUserInput'(X)
  ASSERT result.status = 400
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition_Length(X) AND validRequiredFields(X) DO
  ASSERT submitCheckout(X).status = submitCheckout'(X).status
     AND submitCheckout(X).body = submitCheckout'(X).body
END FOR

FOR ALL X WHERE NOT isBugCondition_AdminLength(X) AND validAdminPayload(X) DO
  ASSERT submitAdmin(X).status = submitAdmin'(X).status
END FOR

FOR ALL X WHERE NOT isBugCondition_ProfileCommentLength(X) DO
  ASSERT submitUserInput(X).status = submitUserInput'(X).status
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (random strings within limits)
- It catches edge cases that manual unit tests might miss (boundary values like exactly 100 chars)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for valid inputs (within-limit strings, filled required fields, single clicks), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Valid Checkout Preservation**: Generate random valid checkout payloads (all fields within limits) → verify order creation succeeds identically
2. **Valid Admin Preservation**: Generate random valid admin payloads within limits → verify CRUD succeeds
3. **Valid Profile Preservation**: Generate random profile updates within limits → verify save succeeds
4. **Valid Comment Preservation**: Generate random comments ≤2000 chars → verify creation succeeds
5. **Image Display Preservation**: Verify images at correct preset dimensions render as before

### Unit Tests

- Test Zod schemas reject strings exceeding `.max()` limits (orders, admin, profile, comments)
- Test Zod schemas accept strings at exactly the limit boundary
- Test `validate()` middleware returns 400 with descriptive error for oversized input
- Test checkout `Field` component renders `maxlength` attribute on input element
- Test InlineEditor renders `maxlength` when prop is provided
- Test BouncingLoader renders without text when `label` is omitted
- Test `getProxyUrl` returns direct Supabase URL (not wsrv.nl)
- Test submit button becomes disabled during loading state

### Property-Based Tests

- Generate random strings of length 1..200 and verify: strings ≤100 pass `customer_name` schema, strings >100 are rejected
- Generate random checkout payloads with all combinations of empty/filled required fields — verify error message count matches empty field count
- Generate random admin category payloads — verify acceptance/rejection matches limit boundaries
- Generate random comment content of length 1..5000 — verify acceptance ≤2000, rejection >2000
- Generate random valid payloads within all limits — verify API returns success (preservation)

### Integration Tests

- Full checkout flow: fill valid form → submit → verify single API call → verify order confirmation screen
- Full checkout flow with oversized input: verify rejection at client (maxlength) and server (400)
- Admin categories CRUD: create with valid data → verify 201; create with oversized slug → verify 400
- Image loading: verify product cards display images without ORB errors
- Profile update: valid data → 200; oversized → 400
- Banner form with non-English locale: trigger validation error → verify localized message appears
