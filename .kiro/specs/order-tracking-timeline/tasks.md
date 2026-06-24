# Implementation Plan: Order Status Tracking Timeline

## Overview

Implements a customer-facing order tracking page with a visual timeline stepper, backed by a status history table and a new API endpoint. The implementation proceeds bottom-up: database migration → API endpoint → frontend components → integration wiring. TypeScript throughout, with property-based tests validating correctness properties from the design.

## Tasks

- [x] 1. Database migration and status history persistence
  - [x] 1.1 Create `order_status_history` table migration
    - Create the table with columns: id (UUID PK), order_id (UUID FK → orders), old_status (TEXT nullable), new_status (TEXT NOT NULL), changed_at (TIMESTAMPTZ DEFAULT now()), changed_by (UUID nullable)
    - Add index on `order_id` and composite index on `(order_id, changed_at)`
    - Enable RLS with a SELECT policy for users reading their own order history
    - Use Supabase MCP `apply_migration` tool
    - _Requirements: 1.1, 1.4_

  - [x] 1.2 Insert initial history record on order creation
    - In the existing `POST /orders` handler (routes/orders.ts), after order insertion, insert a history row with `old_status: null`, `new_status: "pending"`, `changed_by: req.user.id`
    - Wrap in try/catch — log failure but do not block order creation
    - _Requirements: 1.3_

  - [x] 1.3 Insert history record on admin status change
    - In the existing `PATCH /admin/orders/:id/status` handler (routes/admin/orders.ts), after the status UPDATE succeeds, insert a history row with old and new status values, `changed_by: req.admin.id`
    - Wrap in try/catch — log failure but do not block the status update
    - _Requirements: 1.2_

- [x] 2. API endpoint for order tracking
  - [x] 2.1 Implement `GET /profile/orders/:id` endpoint
    - Add route in `routes/orders.ts` with `requireUser` middleware
    - Accept full UUID or 8-char short ID (use `.like('id', `${id}%`)` for short IDs)
    - Fetch order, validate `user_id === req.user.id` (return 404 if mismatch or not found)
    - Fetch order_items joined with order
    - Fetch order_status_history sorted by `changed_at` ASC
    - Compute `line_total` (quantity × product_price_snapshot) for each item
    - Return combined response matching the design interface
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.2 Write property test for API history sorting (Property 1)
    - **Property 1: Status history is sorted by changed_at ascending**
    - Generate arrays of history entries with random timestamps, verify API response maintains ascending order
    - Minimum 100 iterations with fast-check
    - **Validates: Requirements 2.2**

  - [x] 2.3 Write integration tests for API auth and ownership
    - Test 401 for unauthenticated requests (Req 2.4)
    - Test 404 for order belonging to another user (Req 2.3)
    - Test 200 with correct data shape for valid request (Req 2.1, 2.2)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 3. Checkpoint - Ensure API layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. StatusStepper component and step derivation logic
  - [x] 4.1 Implement step state derivation utility
    - Create `artifacts/store/src/lib/order-tracking/deriveStepStates.ts`
    - Export `HAPPY_PATH_STEPS`, `STEP_INDEX`, `StepState` type, and `deriveStepStates()` function per design
    - Handle: normal progression, "delivered" (all success), "cancelled"/"refused_at_delivery" (failure derivation from history)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7_

  - [x] 4.2 Write property test for delivered status (Property 2)
    - **Property 2: Delivered status renders all steps as complete**
    - For any order data with status "delivered", verify `deriveStepStates` returns all five steps as "success"
    - Minimum 100 iterations with fast-check
    - **Validates: Requirements 3.6**

  - [x] 4.3 Write property test for terminal failure status (Property 3)
    - **Property 3: Terminal failure status renders failure indicator**
    - For any order with status "cancelled" or "refused_at_delivery", verify derivation produces no "active" state and the component logic exposes failure
    - Minimum 100 iterations with fast-check
    - **Validates: Requirements 3.7**

  - [x] 4.4 Implement StatusStepper component
    - Create `artifacts/store/src/components/storefront/order/StatusStepper.tsx`
    - Render steps from `HAPPY_PATH_STEPS` with state-based styling (completed: check + primary, active: highlighted, future: muted)
    - Connect steps with a progress line (colored for completed, muted for incomplete)
    - Display timestamps beneath completed steps from history
    - For terminal failure states, render a failure badge with destructive styling
    - Responsive: vertical layout on `< sm` (640px), horizontal on `≥ sm`
    - Accessibility: `aria-label` on container, `aria-current="step"` on active step
    - All labels via `t()` function
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 7.1, 7.2, 9.1, 9.2_

  - [x] 4.5 Write property test for completed steps displaying timestamps (Property 4)
    - **Property 4: Completed steps display their history timestamp**
    - For any StatusStepper with history, each "completed"/"success" step displays the `changed_at` from the matching history entry
    - Minimum 100 iterations with fast-check
    - **Validates: Requirements 3.8**

- [x] 5. Order tracking page and details display
  - [x] 5.1 Implement OrderTrackingPage component
    - Create `artifacts/store/src/pages/storefront/OrderTrackingPage.tsx`
    - Accept `locale` and `shortId` props
    - Fetch order data via `userFetch` to `GET /api/profile/orders/:shortId`
    - Handle loading, error (401 → sign-in prompt, 404 → "Order not found" with profile link), network failure (retry button)
    - Render: page title (h1), StatusStepper, order details section (h2), delivery info section
    - Display: customer name, delivery address, order items with title/quantity/line_total, order total in AZN
    - Conditionally show discount only when `discount_azn > 0`
    - Display order creation date formatted per locale
    - Semantic heading hierarchy (h1, h2)
    - Focus indicators: `focus-visible:ring-1 focus-visible:ring-ring`
    - Max-width `max-w-2xl` on desktop, full-width with padding on mobile
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.3, 7.4, 9.3, 9.4_

  - [x] 5.2 Write property test for order items display (Property 5)
    - **Property 5: All order items are displayed with required fields**
    - For any array of order items, verify rendered output contains each item's title, quantity, and line_total, and row count equals array length
    - Minimum 100 iterations with fast-check
    - **Validates: Requirements 5.3**

  - [x] 5.3 Write property test for discount visibility (Property 6)
    - **Property 6: Discount section visibility follows non-zero rule**
    - For any order data, discount section visible iff `discount_azn > 0`
    - Minimum 100 iterations with fast-check
    - **Validates: Requirements 5.5**

  - [x] 5.4 Implement DeliveryInfo section logic
    - Within OrderTrackingPage, implement conditional delivery messaging per design:
      - "shipped" → estimated delivery message
      - "courier_assigned" → courier preparing message
      - "delivered" → actual delivery timestamp from history
      - "cancelled"/"refused_at_delivery" → hide section
      - default → "processing order" message
    - All messages via `t()` function
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 6. Checkpoint - Ensure component tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Routing, navigation, and i18n wiring
  - [x] 7.1 Register route in App.tsx
    - Add `/{locale}/orders/:shortId` route in `StorefrontRoutes` section
    - Pass `locale` and `shortId` params to `OrderTrackingPage`
    - _Requirements: 4.1_

  - [x] 7.2 Add "Track Order" navigation to OrderCard
    - In the existing OrderCard component, add a "Track Order" link/button inside the expanded section
    - Navigate to `/{locale}/orders/{order.id.slice(0, 8)}` using wouter
    - _Requirements: 4.3_

  - [x] 7.3 Add i18n translation keys for all three locales
    - Add keys to `lib/i18n/messages/az.ts`, `ru.ts`, `en.ts`:
      - Step labels: stepPending, stepVerified, stepCourierAssigned, stepShipped, stepDelivered
      - Delivery info: estimatedDelivery, courierPreparing, deliveredAt, delivered, processingOrder
      - Page: orderTracking (title), orderNotFound, backToProfile, signInRequired, trackOrder, orderDetails, deliveryAddress, orderItems, orderTotal, discount, orderDate
      - Terminal states: statusCancelled, statusRefusedAtDelivery
    - _Requirements: 8.1, 8.2, 8.4_

  - [x] 7.4 Write property test for date formatting locale (Property 7)
    - **Property 7: Date formatting respects active locale**
    - For any valid timestamp and locale in {az, ru, en}, verify formatted output uses correct locale identifier
    - Minimum 100 iterations with fast-check
    - **Validates: Requirements 8.3**

- [x] 8. Final checkpoint - Ensure all tests pass and typecheck succeeds
  - Run `pnpm run typecheck` and `pnpm run test`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design (7 properties total)
- Unit tests validate specific examples and edge cases
- The API uses 404 for both "not found" and "not owned" deliberately (security design decision from Req 2.3)
- Orders created before this feature will have empty history — stepper gracefully degrades by hiding timestamps
- All user-facing strings must go through `t()` — no hardcoded text

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "4.2", "4.3"] },
    { "id": 4, "tasks": ["4.4"] },
    { "id": 5, "tasks": ["4.5", "5.1", "5.4"] },
    { "id": 6, "tasks": ["5.2", "5.3"] },
    { "id": 7, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 8, "tasks": ["7.4"] }
  ]
}
```
