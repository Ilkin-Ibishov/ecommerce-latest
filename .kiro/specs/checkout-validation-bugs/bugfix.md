# Bugfix Requirements Document

## Introduction

Multiple critical and high-severity bugs were discovered during ScoutQA exploratory testing and subsequent codebase analysis of the white-label e-commerce platform. The bugs span checkout, admin panel, profile, comments, and storefront UX — collectively compromising security (DoS via unbounded input), user experience (silent validation failures, duplicate submissions, hardcoded English strings, redundant loading text), and core functionality (100% image loading failure). This document captures the defective behavior, defines the expected corrections, and specifies which existing behaviors must be preserved.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user types more than 255 characters into the Name, Address, or Notes form fields on the checkout page THEN the system accepts the input without restriction (tested up to 5000+ characters) because no `maxlength` attribute is set on any input element

1.2 WHEN a user types more than 50 characters into the Coupon Code input field THEN the system accepts the input without restriction because no `maxlength` attribute is set

1.2b WHEN a user types more than 20 characters into the Phone Number field THEN the system accepts the input without restriction because no `maxlength` attribute is set (international phone numbers are at most 15 digits plus prefix characters)

1.3 WHEN the API receives a POST to `/api/orders` with `customer_name`, `delivery_address`, or `notes` fields exceeding reasonable length limits THEN the system processes the request without rejecting oversized payloads, enabling potential DoS or database overflow attacks

1.4 WHEN a user submits the checkout form with all required fields empty (customer_name, customer_phone, delivery_address) by clicking the submit button THEN the system provides no visual feedback — no error messages appear, no fields are highlighted, and the button click has no observable effect

1.5 WHEN a user rapidly clicks the checkout submit button multiple times (e.g., 5 times in quick succession) THEN the system fires multiple concurrent POST requests to `/api/orders` because the button has no disabled/loading state during submission and no debouncing mechanism

1.6 WHEN the storefront attempts to load product images via the wsrv.nl CDN proxy (e.g., `https://wsrv.nl/?url=...`) THEN the browser blocks the response due to Cross-Origin Read Blocking (ORB/CORB), resulting in 100% of product images failing to display

1.7 WHEN the wsrv.nl proxy image fails to load and the `onError` fallback triggers to load the raw image URL directly THEN the fallback also fails because the raw Supabase Storage URLs may also be blocked or inaccessible from the client, leaving a broken image state

#### Admin Panel — Missing Validation & Loading States

1.8 WHEN an admin submits the Categories form (POST/PATCH `/admin/categories`) THEN the API accepts the request with no Zod `validate()` middleware — slug, icon_url, and translations fields have zero type or length checking server-side

1.9 WHEN an admin types into the Categories form inputs (slug, icon_url, title per locale) THEN the client accepts unlimited input because no `maxlength` attribute is set on any field

1.10 WHEN an admin submits the Categories form with an empty slug THEN the form does a silent `return` with no error message displayed to the user

1.11 WHEN an admin submits the Products form (via `ProductFormPage`) with no slug or no translation title THEN the form does a silent `return` with no error message — no visual feedback indicating what is wrong

1.12 WHEN an admin types into ProductFormPage inputs (SKU, slug, brand, title, description, spec keys/values) THEN the client accepts unlimited input because no `maxlength` attribute is set

1.13 WHEN an admin submits a Coupon form THEN the existing Zod schemas (`CreateCouponSchema`, `UpdateCouponSchema`) accept `z.string()` fields (code, description) without any `.max()` length limit, allowing arbitrarily long strings

1.14 WHEN an admin submits a Banner form THEN the existing Zod schemas (`CreateBannerSchema`, `UpdateBannerSchema`) accept `z.string()` fields (title, subtitle, cta_text, cta_url) without any `.max()` length limit

1.15 WHEN an admin submits the Banner form with an empty title THEN the form shows `"Title is required."` hardcoded in English instead of using `t()` for localization — a broken i18n experience for non-English users

1.16 WHEN an admin rapidly clicks the Wishlist "remove" button or the Coupons "toggleActive"/"delete" buttons THEN multiple API requests fire because these buttons have no per-item loading or disabled state

#### Profile & Comments — Missing Server-Side Validation

1.17 WHEN a user updates their profile via PATCH `/profile` THEN the API accepts `full_name` and `default_address` fields with no length validation — a 50,000-character name would be stored

1.18 WHEN a user posts a product comment via POST `/products/:productId/comments` THEN the API only checks `if (!content?.trim())` but enforces no maximum length — a 100KB comment would be accepted

1.19 WHEN the `InlineEditor` component (used on ProfilePage) is used to save a value THEN there is no `maxLength` on the input and no validation of the saved content

#### UX — Redundant Loading Text

1.20 WHEN any page is in a loading state and displays a loading animation (spinner/skeleton) THEN the system also displays redundant text like "Yüklənir..." or "Loading..." alongside the animation, creating visual noise since the animation already communicates the loading state

### Expected Behavior (Correct)

2.1 WHEN a user types into the Name field THEN the system SHALL enforce a maximum length of 100 characters via `maxlength` attribute on the client and Zod schema validation (max 100) on the server

2.2 WHEN a user types into the Address field THEN the system SHALL enforce a maximum length of 500 characters via `maxlength` attribute on the client and Zod schema validation (max 500) on the server

2.3 WHEN a user types into the Notes field THEN the system SHALL enforce a maximum length of 1000 characters via `maxlength` attribute on the client and Zod schema validation (max 1000) on the server

2.4 WHEN a user types into the Coupon Code field THEN the system SHALL enforce a maximum length of 50 characters via `maxlength` attribute on the client and Zod schema validation (max 50) on the server

2.4b WHEN a user types into the Phone Number field THEN the system SHALL enforce a maximum length of 20 characters via `maxlength` attribute on the client and Zod schema validation (max 20) on the server

2.5 WHEN the API receives a POST to `/api/orders` with any text field exceeding its maximum length THEN the system SHALL reject the request with a 400 status and a descriptive error message before processing

2.6 WHEN a user submits the checkout form with one or more required fields empty or containing only whitespace THEN the system SHALL display an inline error message (using `t()` for localization) below each invalid required field, highlight the field border in the destructive color, and prevent form submission

2.7 WHEN a user clicks the checkout submit button THEN the system SHALL immediately disable the button and show a loading state (spinner or loading text) to prevent duplicate clicks during the API request

2.8 WHEN the submit button is in loading/disabled state and the user attempts to click it again THEN the system SHALL ignore the click and not fire any additional API requests

2.8b WHEN the API request completes (success or failure) THEN the system SHALL re-enable the submit button and remove the loading state, allowing the user to retry on failure

2.9 WHEN product images are loaded on the storefront THEN the system SHALL use a working image delivery mechanism that does not trigger Cross-Origin Read Blocking — either by configuring proper CORS/content-type headers on the proxy, using Supabase Storage public URLs directly with appropriate transforms, or using an alternative image CDN that serves correct headers

2.10 WHEN the primary image source fails to load (proxy or CDN error) THEN the system SHALL gracefully fall back to a placeholder image or skeleton state rather than showing a broken image icon

#### Admin Panel — Validation & Loading State Fixes

2.11 WHEN the API receives a POST or PATCH to `/admin/categories` THEN the system SHALL validate the request body with a Zod schema enforcing: slug (max 100), icon_url (max 500, optional), translations[].title (max 200) — rejecting invalid payloads with 400

2.12 WHEN an admin types into Categories form fields THEN the system SHALL enforce `maxlength` attributes: slug (100), icon_url (500), title per locale (200)

2.13 WHEN an admin submits the Categories form with an empty slug or no translation titles THEN the system SHALL display a localized inline error message using `t()` and prevent submission

2.14 WHEN an admin submits the Products form with no slug or no translation title THEN the system SHALL display a localized inline error message using `t()` indicating which fields are missing, and prevent submission

2.15 WHEN an admin types into ProductFormPage inputs THEN the system SHALL enforce `maxlength` attributes: SKU (50), slug (100), brand (100), title (200), description (5000), spec key (100), spec value (500)

2.16 WHEN the admin Zod schemas for Coupons are evaluated THEN the system SHALL enforce `.max()` limits: code (50), description (500)

2.17 WHEN the admin Zod schemas for Banners are evaluated THEN the system SHALL enforce `.max()` limits: title (200), subtitle (500), cta_text (100), cta_url (500)

2.18 WHEN an admin submits the Banner form with an empty title THEN the system SHALL display a localized error message using `t()` instead of the hardcoded English string

2.19 WHEN an admin clicks the Wishlist "remove" button or Coupons "toggleActive"/"delete" buttons THEN the system SHALL show a per-item loading/disabled state and prevent duplicate API calls during the request

#### Profile & Comments — Server-Side Validation Fixes

2.20 WHEN the API receives a PATCH to `/profile` THEN the system SHALL validate with Zod: full_name (max 100, optional), default_address (max 500, optional) — rejecting oversized payloads with 400

2.21 WHEN the API receives a POST to `/products/:productId/comments` THEN the system SHALL validate content length with Zod (max 2000 characters) — rejecting oversized comments with 400

2.22 WHEN the `InlineEditor` component renders an input THEN the system SHALL accept a `maxLength` prop and enforce it on the input element

#### UX — Loading Text Removal

2.23 WHEN any page is in a loading state and shows a loading animation (spinner/skeleton) THEN the system SHALL NOT display redundant loading text alongside the animation — the animation alone communicates the loading state

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user enters valid data within length limits into checkout form fields THEN the system SHALL CONTINUE TO accept and submit the form successfully without any new restrictions interfering

3.2 WHEN a user enters a valid phone number within the 20-character limit THEN the system SHALL CONTINUE TO normalize and accept the phone number as before

3.3 WHEN a user applies a valid coupon code that is within length limits THEN the system SHALL CONTINUE TO validate and apply the coupon discount correctly

3.4 WHEN a user submits a complete, valid checkout form with all required fields filled THEN the system SHALL CONTINUE TO place the order successfully and show the confirmation screen

3.5 WHEN the checkout form submit button is clicked once with valid data THEN the system SHALL CONTINUE TO fire exactly one API request and complete the order flow

3.6 WHEN product images are available and the image delivery mechanism is working THEN the system SHALL CONTINUE TO display product images at the correct resolution using the preset-based sizing (thumbnail: 300x300, gallery: 1000x1000, lightbox: 1600x1600)

3.7 WHEN the cart contains items with valid prices and quantities THEN the system SHALL CONTINUE TO calculate subtotals, discounts, and totals correctly on the checkout page

3.8 WHEN a user is not authenticated and clicks the submit button THEN the system SHALL CONTINUE TO show the login modal rather than submitting the form

3.9 WHEN an admin submits a valid Categories form with a non-empty slug and at least one translation title THEN the system SHALL CONTINUE TO create/update the category successfully

3.10 WHEN an admin submits a valid Product form with all required fields within limits THEN the system SHALL CONTINUE TO save the product with translations, images, and specs correctly

3.11 WHEN an admin submits a valid Coupon form with code and discount values within limits THEN the system SHALL CONTINUE TO create/update the coupon correctly

3.12 WHEN an admin submits a valid Banner form with title within limits THEN the system SHALL CONTINUE TO save the banner correctly

3.13 WHEN a user updates their profile with a valid full_name (≤100 chars) or default_address (≤500 chars) THEN the system SHALL CONTINUE TO save the profile update and return the updated record

3.14 WHEN a user posts a comment with valid content (≤2000 chars) and optional rating (1–5) THEN the system SHALL CONTINUE TO create the comment in pending/unapproved state

3.15 WHEN a loading animation is displayed during page load THEN the system SHALL CONTINUE TO display the spinner/skeleton animation that indicates loading is in progress (only the text is removed, not the visual indicator)

---

## Bug Condition Derivations

### Bug 1: Missing Input Length Validation

```pascal
FUNCTION isBugCondition_Length(X)
  INPUT: X of type CheckoutFormInput
  OUTPUT: boolean
  
  RETURN X.customer_name.length > 100
      OR X.delivery_address.length > 500
      OR X.notes.length > 1000
      OR X.coupon_code.length > 50
      OR X.customer_phone.length > 20
END FUNCTION
```

```pascal
// Property: Fix Checking - Input Length Enforcement
FOR ALL X WHERE isBugCondition_Length(X) DO
  result ← submitCheckout'(X)
  ASSERT result.rejected = true
     AND result.status = 400
     AND input_truncated_or_blocked(X)
END FOR
```

```pascal
// Property: Preservation Checking - Valid Length Inputs
FOR ALL X WHERE NOT isBugCondition_Length(X) DO
  ASSERT submitCheckout(X) = submitCheckout'(X)
END FOR
```

### Bug 2: Missing Validation Error Messages

```pascal
FUNCTION isBugCondition_EmptyFields(X)
  INPUT: X of type CheckoutFormInput
  OUTPUT: boolean
  
  RETURN X.customer_name.trim() = ""
      OR X.customer_phone.trim() = ""
      OR X.delivery_address.trim() = ""
END FUNCTION
```

```pascal
// Property: Fix Checking - Error Message Display
FOR ALL X WHERE isBugCondition_EmptyFields(X) DO
  result ← validateAndSubmit'(X)
  ASSERT result.errorsDisplayed = true
     AND result.apiRequestFired = false
     AND each_empty_field_has_visible_error(X, result)
END FOR
```

```pascal
// Property: Preservation Checking - Valid Form Submission
FOR ALL X WHERE NOT isBugCondition_EmptyFields(X) DO
  ASSERT validateAndSubmit(X) = validateAndSubmit'(X)
END FOR
```

### Bug 3: No Submit Button Debouncing

```pascal
FUNCTION isBugCondition_RapidClicks(X)
  INPUT: X of type SubmitSequence
  OUTPUT: boolean
  
  RETURN X.clickCount > 1
     AND X.timeBetweenClicks < 1000ms
END FUNCTION
```

```pascal
// Property: Fix Checking - Single Request Per Submission
FOR ALL X WHERE isBugCondition_RapidClicks(X) DO
  result ← handleMultipleClicks'(X)
  ASSERT result.apiRequestCount = 1
     AND result.buttonDisabledAfterFirstClick = true
END FOR
```

```pascal
// Property: Preservation Checking - Single Click Submission
FOR ALL X WHERE NOT isBugCondition_RapidClicks(X) DO
  ASSERT handleSubmit(X) = handleSubmit'(X)
END FOR
```

### Bug 4: Image Loading Failures (ORB Blocking)

```pascal
FUNCTION isBugCondition_ImageLoad(X)
  INPUT: X of type ImageRequest
  OUTPUT: boolean
  
  RETURN X.proxyUrl.contains("wsrv.nl")
     AND browser_blocks_response(X)
END FUNCTION
```

```pascal
// Property: Fix Checking - Images Load Successfully
FOR ALL X WHERE isBugCondition_ImageLoad(X) DO
  result ← loadImage'(X)
  ASSERT result.imageVisible = true
     AND (result.loadedViaNewMechanism = true OR result.fallbackDisplayed = true)
END FOR
```

```pascal
// Property: Preservation Checking - Image Rendering
FOR ALL X WHERE NOT isBugCondition_ImageLoad(X) DO
  ASSERT loadImage(X) = loadImage'(X)
END FOR
```

### Bug 5: Admin Forms Missing Server-Side Validation

```pascal
FUNCTION isBugCondition_AdminLength(X)
  INPUT: X of type AdminFormInput
  OUTPUT: boolean
  
  RETURN (X.route = "/admin/categories" AND (
           X.slug.length > 100
        OR X.icon_url.length > 500
        OR ANY(X.translations, t => t.title.length > 200)))
      OR (X.route = "/admin/products" AND (
           X.sku.length > 50
        OR X.slug.length > 100
        OR X.brand.length > 100))
      OR (X.route = "/admin/coupons" AND (
           X.code.length > 50
        OR X.description.length > 500))
      OR (X.route = "/admin/banners" AND (
           X.title.length > 200
        OR X.subtitle.length > 500
        OR X.cta_text.length > 100
        OR X.cta_url.length > 500))
END FUNCTION
```

```pascal
// Property: Fix Checking - Admin Input Length Enforcement
FOR ALL X WHERE isBugCondition_AdminLength(X) DO
  result ← submitAdmin'(X)
  ASSERT result.rejected = true
     AND result.status = 400
END FOR
```

```pascal
// Property: Preservation Checking - Valid Admin Inputs
FOR ALL X WHERE NOT isBugCondition_AdminLength(X) DO
  ASSERT submitAdmin(X) = submitAdmin'(X)
END FOR
```

### Bug 6: Profile & Comments Missing Length Validation

```pascal
FUNCTION isBugCondition_ProfileCommentLength(X)
  INPUT: X of type UserInput
  OUTPUT: boolean
  
  RETURN (X.route = "/profile" AND (
           X.full_name.length > 100
        OR X.default_address.length > 500))
      OR (X.route = "/products/:id/comments" AND (
           X.content.length > 2000))
END FUNCTION
```

```pascal
// Property: Fix Checking - Profile/Comment Length Enforcement
FOR ALL X WHERE isBugCondition_ProfileCommentLength(X) DO
  result ← submitUserInput'(X)
  ASSERT result.rejected = true
     AND result.status = 400
END FOR
```

```pascal
// Property: Preservation Checking - Valid Profile/Comment Inputs
FOR ALL X WHERE NOT isBugCondition_ProfileCommentLength(X) DO
  ASSERT submitUserInput(X) = submitUserInput'(X)
END FOR
```

### Bug 7: Hardcoded English Error Messages

```pascal
FUNCTION isBugCondition_HardcodedString(X)
  INPUT: X of type UIComponent
  OUTPUT: boolean
  
  RETURN X.displaysErrorMessage = true
     AND X.errorMessageSource != "t()"
     AND X.locale != "en"
END FUNCTION
```

```pascal
// Property: Fix Checking - Localized Error Messages
FOR ALL X WHERE isBugCondition_HardcodedString(X) DO
  result ← renderComponent'(X)
  ASSERT result.errorMessageSource = "t()"
     AND result.errorMessageLocale = X.locale
END FOR
```

### Bug 8: Redundant Loading Text

```pascal
FUNCTION isBugCondition_RedundantLoadingText(X)
  INPUT: X of type PageLoadState
  OUTPUT: boolean
  
  RETURN X.hasLoadingAnimation = true
     AND X.hasLoadingText = true
END FUNCTION
```

```pascal
// Property: Fix Checking - No Redundant Loading Text
FOR ALL X WHERE isBugCondition_RedundantLoadingText(X) DO
  result ← renderLoadingState'(X)
  ASSERT result.hasLoadingAnimation = true
     AND result.hasLoadingText = false
END FOR
```
