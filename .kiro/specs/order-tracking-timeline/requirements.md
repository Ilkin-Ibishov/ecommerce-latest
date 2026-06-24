# Requirements Document

## Introduction

Order Status Tracking Timeline provides customers with a dedicated page showing the real-time progression of their orders through a visual timeline/stepper UI. The feature introduces a status history table to record timestamps for each status transition, a new route accessible from both the profile page and a direct shareable link, and a responsive detail view displaying order items, delivery address, and estimated delivery information. The page supports all three locales (az/ru/en) and handles both happy-path progressions and terminal failure states.

## Glossary

- **Timeline_Page**: The dedicated order tracking page that displays order progression, details, and status history
- **Status_Stepper**: The visual timeline component that renders completed, current, and future steps with appropriate styling
- **Order_Status_History**: The Supabase database table (`order_status_history`) recording each status transition with a timestamp
- **Short_ID**: The first 8 characters of the order UUID, used in URLs and display
- **Terminal_State**: A status that ends the order lifecycle — "delivered" (success), "cancelled" or "refused_at_delivery" (failure)
- **Happy_Path**: The normal order progression: pending → phone_verified → courier_assigned → shipped → delivered
- **API_Server**: The Express 5 backend that serves order data and status history
- **Store_App**: The React 19 SPA storefront application

## Requirements

### Requirement 1: Order Status History Persistence

**User Story:** As a customer, I want to see when each status change happened, so that I can track the exact timeline of my order.

#### Acceptance Criteria

1. THE Order_Status_History table SHALL store a record with order_id, old_status, new_status, changed_at timestamp, and changed_by user ID for each status transition
2. WHEN the admin changes an order status via PATCH `/admin/orders/:id/status`, THE API_Server SHALL insert a corresponding row into the Order_Status_History table. IF the history insertion fails, THE API_Server SHALL still complete the status change (non-blocking; log the failure).
3. WHEN an order is first created with status "pending", THE API_Server SHALL insert an initial history record with old_status as NULL and new_status as "pending"
4. THE Order_Status_History table SHALL enforce a foreign key constraint referencing the orders table on order_id

### Requirement 2: Order Tracking API Endpoint

**User Story:** As a customer, I want to fetch my order details and status history through a single request, so that the tracking page loads efficiently.

#### Acceptance Criteria

1. THE API_Server SHALL expose a GET `/profile/orders/:id` endpoint that returns the order details, order items, and status history for an authenticated user
2. WHEN an authenticated user requests an order that belongs to them, THE API_Server SHALL return the order with its full status history sorted by changed_at ascending
3. WHEN an authenticated user requests an order that does not belong to them, THE API_Server SHALL respond with 404 status (not 403) to avoid revealing order existence to unauthorized users
4. WHEN an unauthenticated request is made to the endpoint, THE API_Server SHALL respond with 401 status regardless of whether the order exists (authentication checked before ownership)

### Requirement 3: Visual Timeline Stepper Component

**User Story:** As a customer, I want to see a clear visual timeline showing where my order is in the delivery process, so that I can understand progress at a glance.

#### Acceptance Criteria

1. THE Status_Stepper SHALL render the Happy_Path steps in order: Pending → Verified → Courier Assigned → Shipped → Delivered
2. THE Status_Stepper SHALL display completed steps with a check icon and primary color styling
3. THE Status_Stepper SHALL display the current active step with highlighted primary styling and a distinct indicator
4. THE Status_Stepper SHALL display future steps with greyed-out muted styling
5. THE Status_Stepper SHALL connect steps with a progress line that is colored for completed segments and muted for incomplete segments
6. WHEN the order status is a Terminal_State of "delivered", THE Status_Stepper SHALL display all steps as complete with success styling (green)
7. WHEN the order status is a Terminal_State of "cancelled" or "refused_at_delivery", THE Status_Stepper SHALL display a failure indicator with destructive styling (red) and show the label of the terminal state
8. THE Status_Stepper SHALL display the timestamp from Order_Status_History beneath each completed step

### Requirement 4: Order Tracking Page Route

**User Story:** As a customer, I want to access my order tracking page through a direct link or from my profile, so that I can check status from any entry point.

#### Acceptance Criteria

1. THE Store_App SHALL register a route at `/{locale}/orders/{shortId}` that renders the Timeline_Page
2. WHEN a user navigates to `/{locale}/orders/{shortId}`, THE Timeline_Page SHALL fetch and display the corresponding order's tracking information
3. WHEN the OrderCard in the profile page is clicked, THE Store_App SHALL navigate to `/{locale}/orders/{shortId}` for the selected order
4. WHEN the order is not found or does not belong to the user, THE Timeline_Page SHALL display "Order not found" message with a link back to the profile page (single message for both cases to avoid revealing order existence)
5. WHEN the user is not authenticated, THE Timeline_Page SHALL prompt the user to sign in before displaying order data

### Requirement 5: Order Details Display

**User Story:** As a customer, I want to see my order details alongside the timeline, so that I can verify item information and delivery address.

#### Acceptance Criteria

1. THE Timeline_Page SHALL display the customer name associated with the order
2. THE Timeline_Page SHALL display the delivery address for the order
3. THE Timeline_Page SHALL display a list of order items with product title, quantity, and line total
4. THE Timeline_Page SHALL display the order total amount in AZN
5. WHEN the order has a discount applied with a non-zero discount amount, THE Timeline_Page SHALL display the discount amount. WHILE the discount amount is zero, THE Timeline_Page SHALL NOT show the discount section.
6. THE Timeline_Page SHALL display the order creation date in a localized format

### Requirement 6: Estimated Delivery Information

**User Story:** As a customer, I want to see estimated delivery timing, so that I can plan for receiving my order.

#### Acceptance Criteria

1. WHILE the order status is "shipped", THE Timeline_Page SHALL display an estimated delivery message
2. WHILE the order status is "courier_assigned", THE Timeline_Page SHALL display a message indicating the courier is preparing the delivery
3. WHEN the order status is "delivered", THE Timeline_Page SHALL display the actual delivery timestamp from Order_Status_History
4. WHEN the order status is a Terminal_State of "cancelled" or "refused_at_delivery", THE Timeline_Page SHALL hide the estimated delivery section

### Requirement 7: Mobile-Responsive Layout

**User Story:** As a mobile user in Azerbaijan, I want the tracking page to work well on my phone, so that I can track orders on the device I primarily use.

#### Acceptance Criteria

1. THE Timeline_Page SHALL render the Status_Stepper vertically on viewports narrower than 640px
2. THE Timeline_Page SHALL render the Status_Stepper horizontally on viewports 640px and wider (inclusive: exactly 640px uses horizontal layout)
3. THE Timeline_Page SHALL use full-width layout with appropriate padding on mobile viewports
4. THE Timeline_Page SHALL constrain content to a maximum width of 672px (max-w-2xl) on larger screens

### Requirement 8: Internationalization

**User Story:** As a customer, I want the tracking page in my preferred language, so that I can understand all information clearly.

#### Acceptance Criteria

1. THE Timeline_Page SHALL display all user-facing text through the i18n `t()` function
2. THE Store_App SHALL include translation keys for the Timeline_Page in all three locale files (az, ru, en)
3. THE Timeline_Page SHALL format dates and timestamps according to the active locale
4. THE Status_Stepper step labels SHALL be translated using the `t()` function

### Requirement 9: Accessibility

**User Story:** As a user with assistive technology, I want the tracking timeline to be navigable and understandable, so that I can access order status information.

#### Acceptance Criteria

1. THE Status_Stepper SHALL use an `aria-label` attribute describing the overall order progress (e.g., "Order progress: step 3 of 5, Shipped")
2. THE Status_Stepper SHALL mark each step with `aria-current="step"` for the active step
3. THE Timeline_Page SHALL use semantic heading hierarchy (h1 for page title, h2 for sections)
4. THE Timeline_Page SHALL ensure all interactive elements have visible focus indicators using `focus-visible:ring-1 focus-visible:ring-ring`
