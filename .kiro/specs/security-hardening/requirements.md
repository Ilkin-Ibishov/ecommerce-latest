# Requirements Document

## Introduction

This document specifies the requirements for remediating 7 security findings (3 P0, 4 P1) identified during the static security audit of the White-Label E-Commerce platform. The findings span input validation, secret exposure, access control, dependency vulnerabilities, race conditions, and file upload validation. All fixes target the `@workspace/api-server` Express 5 backend and the `@workspace/store` React SPA frontend.

## Glossary

- **Order_Service**: The Express 5 route handler module at `routes/orders.ts` responsible for order creation, stock management, and coupon application
- **API_Server**: The Express 5 REST API application at `artifacts/api-server`
- **Store_SPA**: The React 19 single-page application at `artifacts/store`
- **Bootstrap_Endpoint**: The `POST /bootstrap/admin` route at `routes/bootstrap.ts` that creates the first admin account
- **Upload_Handler**: The `POST /admin/upload` route handler in `routes/admin/products.ts` responsible for product image uploads
- **Notification_Proxy**: A new API server route that proxies platform notification requests on behalf of the Store_SPA, keeping secrets server-side
- **Validate_Middleware**: The existing `validate(schema)` Zod middleware at `middlewares/validate.ts` that validates request bodies against Zod schemas
- **DecrementStockSafe_RPC**: The atomic Supabase RPC wrapper in `lib/rpc.ts` that decrements product stock with a `stock >= quantity` guard
- **IncrementStock_RPC**: The atomic Supabase RPC wrapper in `lib/rpc.ts` that increments product stock (used for rollback)
- **DetectMimeType**: The existing function in `lib/asset-uploader.ts` that identifies file MIME type by reading magic bytes from a buffer
- **TOCTOU**: Time-of-check-to-time-of-use race condition where state changes between verification and action
- **Fail_Closed**: A security design principle where a system denies access by default when configuration or validation state is indeterminate

## Requirements

### Requirement 1: Order Quantity Validation

**User Story:** As a platform operator, I want order item quantities validated on the server, so that invalid orders with negative, zero, fractional, or excessively large quantities cannot be submitted.

#### Acceptance Criteria

1. WHEN a `POST /api/orders` request is received, THE Order_Service SHALL validate each item quantity as a positive integer between 1 and 99 inclusive using Zod schema validation via the Validate_Middleware
2. IF any item quantity in the request body is not a positive integer between 1 and 99 inclusive, THEN THE Order_Service SHALL reject the request with HTTP 400 and a descriptive error message before any database operations occur
3. WHEN a valid order request passes quantity validation, THE Order_Service SHALL proceed with product lookup and stock verification using the validated integer quantities

### Requirement 2: Platform Secret Removal from Client Bundle

**User Story:** As a security engineer, I want the platform secret removed from the client-side JavaScript bundle, so that credentials are not exposed to end users via browser developer tools or source maps.

#### Acceptance Criteria

1. THE Store_SPA SHALL NOT reference any environment variable containing a platform secret with the `VITE_` prefix
2. THE API_Server SHALL expose a proxy route at `GET /api/platform/notifications` that forwards requests to the control-plane store-feed endpoint using the server-side `STORE_PLATFORM_SECRET` environment variable
3. WHEN the Store_SPA notification center fetches platform notifications, THE Store_SPA SHALL send requests to the API_Server Notification_Proxy route instead of directly to the control-plane endpoint
4. THE Notification_Proxy SHALL authenticate incoming requests using the existing `requireUser` middleware before forwarding to the control-plane
5. IF the `STORE_PLATFORM_SECRET` environment variable is not configured on the API_Server, THEN THE Notification_Proxy SHALL return HTTP 503 with a generic error message

### Requirement 3: Bootstrap Endpoint Fail-Closed Access Control

**User Story:** As a platform operator, I want the bootstrap endpoint to deny access when the bootstrap secret is not configured, so that misconfigured deployments cannot be exploited for unauthorized admin creation.

#### Acceptance Criteria

1. WHEN the `BOOTSTRAP_SECRET` environment variable is not set or is empty, THE Bootstrap_Endpoint SHALL reject all requests with HTTP 403 and a generic error message
2. WHEN the `BOOTSTRAP_SECRET` environment variable is set, THE Bootstrap_Endpoint SHALL require the request body `secret` field to match the configured value using constant-time comparison
3. IF the request body `secret` field does not match the configured `BOOTSTRAP_SECRET`, THEN THE Bootstrap_Endpoint SHALL reject the request with HTTP 403

### Requirement 4: Dependency Vulnerability Remediation

**User Story:** As a platform operator, I want all critical and high-severity dependency vulnerabilities patched, so that the platform is not exposed to known exploits in third-party packages.

#### Acceptance Criteria

1. THE API_Server SHALL use multer version 2.2.0 or higher to remediate the denial-of-service vulnerability
2. THE Store_SPA SHALL use vite version 7.3.5 or higher to remediate the path traversal vulnerability
3. THE API_Server SHALL use vitest version 3.2.6 or higher to remediate the remote code execution vulnerability
4. THE API_Server SHALL use undici version 7.28.0 or higher to remediate the TLS bypass and denial-of-service vulnerabilities
5. WHEN dependency updates are applied, THE API_Server SHALL pass `pnpm audit` with zero critical or high severity findings

### Requirement 5: Order Creation TOCTOU Race Condition Fix

**User Story:** As a platform operator, I want stock decremented before order creation, so that concurrent requests cannot create orders for stock that has already been claimed.

#### Acceptance Criteria

1. WHEN a `POST /api/orders` request passes validation, THE Order_Service SHALL decrement stock for all order items via DecrementStockSafe_RPC before inserting the order record into the database
2. IF any DecrementStockSafe_RPC call fails due to insufficient stock, THEN THE Order_Service SHALL roll back all previously decremented stock using IncrementStock_RPC and return HTTP 409 with an out-of-stock error
3. WHEN all stock decrements succeed, THE Order_Service SHALL insert the order record and order items into the database
4. IF the order insert fails after successful stock decrements, THEN THE Order_Service SHALL roll back all decremented stock using IncrementStock_RPC and return HTTP 500

### Requirement 6: Coupon Per-User Usage Check Ordering Fix

**User Story:** As a platform operator, I want per-user coupon limits checked before incrementing global usage counts, so that concurrent requests from the same user cannot exceed the per-user limit.

#### Acceptance Criteria

1. WHEN a coupon with a `max_uses_per_user` limit is applied to an order, THE Order_Service SHALL verify the per-user usage count before incrementing the global `used_count`
2. IF the per-user usage count for the requesting user meets or exceeds `max_uses_per_user`, THEN THE Order_Service SHALL reject the coupon application with HTTP 400 and a descriptive error message without modifying `used_count`
3. WHEN the per-user check passes, THE Order_Service SHALL increment the global `used_count` with a conditional guard (`used_count < max_uses`)
4. WHEN the per-user check passes and global increment succeeds, THE Order_Service SHALL insert a record into `coupon_usages` for the user

### Requirement 7: Product Upload Magic Byte Validation

**User Story:** As a security engineer, I want product image uploads validated by magic bytes, so that extension-spoofed malicious files cannot be stored on the platform.

#### Acceptance Criteria

1. WHEN a file is uploaded via `POST /admin/upload`, THE Upload_Handler SHALL validate the file content using the DetectMimeType function to verify the actual MIME type matches an allowed image type (image/jpeg, image/png, image/webp, image/avif)
2. IF the DetectMimeType function returns null (unrecognized magic bytes), THEN THE Upload_Handler SHALL reject the upload with HTTP 415 and an error message indicating the file type is not supported
3. IF the detected MIME type does not match the allowed image types, THEN THE Upload_Handler SHALL reject the upload with HTTP 415
4. WHEN magic byte validation passes, THE Upload_Handler SHALL use the detected extension from DetectMimeType for the stored filename instead of the client-provided extension
