# Requirements Document

## Introduction

The Super Admin Platform is a dedicated **control plane** for the platform owner who leases ready-made white-label e-commerce websites to store owners. Each leased site is an **isolated instance** with its own database (a separate Supabase project / separate datastore). The existing live store is one such instance and is left essentially untouched. The Super Admin operates a **standalone control-plane application** with its own separate database that holds only platform-owner data: a registry of Stores, their status, owner contact, subscription/plan/billing information, invoices, and the platform notifications the owner sends.

### Chosen architecture (control plane + physically isolated per-store databases)

This spec adopts a control plane plus physically isolated per-store databases instead of a shared-schema, row-level multi-tenancy model. The decision was made to minimize failure risk to the live store: the existing store's schema is **not** migrated (no per-table discriminator column, no isolation-by-row-level-security retrofit, no auth-hook claim changes), and isolation is **physical** rather than logical. Because every Store owns a separate database, cross-store data exposure is structurally impossible — the control plane never holds another store's raw records.

The critical isolation principle is that the control plane NEVER directly reads or writes any Store's domain data. Where the control plane needs store intel (orders, revenue, optional traffic), it obtains aggregate numbers from each Store's own authenticated, read-only metrics endpoint and stores at most cached aggregate numbers, never raw store records. Stores are changed only additively: a Store checks its platform status to gate itself, and a Store's admin panel fetches platform notifications from a control-plane endpoint. These are additive integrations, not schema migrations.

### Phasing note (intended delivery order, not a change to the "what")

The requirements below describe the desired behavior independent of delivery order. The intended delivery order is:

- **Phase 0**: Control-plane application with its own database, Super_Admin authentication and MFA, the Store_Registry, and the platform-status enforcement hook embedded in Stores.
- **Phase 1**: Cross-store dashboard (status + metrics obtained via Store metrics endpoints), suspend/reactivate, and platform notifications delivered to Stores.
- **Phase 2**: Subscription plans, invoices and manual billing with optional automation, and platform analytics.
- **Phase 3**: Support impersonation/access, offboarding and retention, plan-based quota limits, and email-delivery hardening.

### Architectural note (context, not a requirement)

The existing store stays single-store and untouched; no discriminator column is added to its tables and its row-level security is not repurposed as a tenancy boundary. All new work is a **separate control-plane application** with its own database plus **additive store hooks** (a platform-status check and a notifications fetch). The existing `notifications` table in a Store remains a WhatsApp delivery queue and is a store-local concern; platform notifications are a distinct control-plane concept delivered to a Store's notification feed. Requirements below are stated in terms of desired behavior (the "what"), leaving the specific data model and endpoints to design.

## Glossary

- **Platform**: The overall white-label leasing business that operates the Control_Plane and leases multiple isolated Store instances.
- **Control_Plane**: The standalone Super_Admin application (its frontend surfaces and its backend) that administers the Platform, with its own separate database.
- **Control_Plane_Database**: The Control_Plane's own database, separate from every Store's database, holding only platform-owner data: the Store_Registry, subscription/plan/billing records, invoices, platform notifications, and the Platform_Audit_Log. It holds at most cached aggregate numbers about a Store, never a Store's raw records.
- **Super_Admin**: The single platform-level operator account that owns and administers the Platform via the Control_Plane. Distinct from a Store_Admin.
- **Super_Admin_Service**: The Control_Plane backend component that authenticates and authorizes Super_Admin requests and exposes the platform control-plane endpoints.
- **Store**: One leased store instance, comprising its storefront, its admin users, and all of its domain data, hosted on its **own** database (a separate Supabase project / separate datastore). Identified by a unique Store identifier in the Store_Registry.
- **Store_Admin**: A per-store administrator who manages one Store's storefront and admin panel via that Store's existing `requireAdmin` privilege tier. A Store_Admin operates only within their own Store instance.
- **Storefront**: The public-facing React SPA experienced by a Store's shoppers.
- **Store_Registry**: The Control_Plane_Database record set listing every Store, including its identifier, name, instance URL, Store_Metrics_Endpoint location, per-Store shared secret reference, owner contact email, Platform_Status, Subscription_Status, and Subscription_Plan assignment.
- **Store_Metrics_Endpoint**: A Store-exposed, authenticated, read-only endpoint that returns aggregate numbers about that Store (for example order count and revenue total, and optionally traffic count) and never raw store records. The Control_Plane polls it and authenticates with that Store's per-Store credential.
- **Per_Store_Credential**: A per-Store shared secret used by the Control_Plane to authenticate to one Store's Store_Metrics_Endpoint and notification-fetch endpoint, and used by the Store to authenticate Control_Plane requests. Each Store has its own distinct credential.
- **Platform_Status**: The operational state of a Store as recorded in the Store_Registry and **enforced by the Store itself**, one of: `onboarding`, `active`, `suspended`, `disabled`. The Store reads its Platform_Status and gates itself accordingly.
- **Subscription_Status**: A Store's billing state, one of: `trialing`, `active`, `past_due`, `cancelled`. Recorded in the Control_Plane_Database.
- **Store_Dashboard**: The Super_Admin-facing Control_Plane view that aggregates per-Store status and metrics across all Stores.
- **Suspension_Service**: The Control_Plane backend component that sets a Store's Platform_Status in the Store_Registry. Enforcement of the status is performed by the Store, not by the Control_Plane.
- **Notification_Service**: The Control_Plane backend component that composes, targets, stores, and delivers platform notifications to Stores' notification feeds.
- **Notification_Center**: The Store_Admin-facing inbox UI that lists the platform notifications fetched for that Store from the Control_Plane, with read/unread state.
- **Notification**: A single platform message addressed to one or more Stores, held in the Control_Plane_Database and fetched by each targeted Store.
- **Platform_Message**: A Notification authored by the Super_Admin and targeted at one Store, a set of Stores, or all Stores (broadcast).
- **Store_Event_Notification**: A notification generated by a Store's own store events (for example a new order or low stock). This is a store-local concern surfaced within that Store's own admin and is out of scope for the Control_Plane.
- **Impersonation**: A time-bounded, audited, read-only Super_Admin support access to a single Store, obtained through that Store's authenticated endpoint or a generated support link, never through direct database access.
- **Platform_Audit_Log**: The audit trail of Super_Admin and automated control-plane actions, held in the Control_Plane_Database.
- **i18n**: The internationalization layer (`useI18n()` → `t(key)`) with locales `az`, `ru`, `en`.
- **Subscription_Plan**: A named offering that a Store is leased on, defining a price, a Billing_Interval, and a set of feature and Quota limits. Distinct from Subscription_Status. Recorded in the Control_Plane_Database.
- **Billing_Interval**: The recurring period on which a Subscription_Plan is billed (for example monthly or yearly).
- **Quota**: A numeric limit defined by a Subscription_Plan on a countable resource for a Store (for example maximum products, maximum storage, maximum monthly orders, maximum admin users). The Control_Plane records the limit; the Store enforces it against its own data.
- **Invoice**: A billing record generated by the Control_Plane for one Store for one Billing_Interval, with an issue date, a due date, an amount, and a payment state. Held in the Control_Plane_Database.
- **Grace_Period**: A configurable span of time that begins when a Store's Subscription_Status becomes `past_due`, during which the Store remains `active` before automatic suspension occurs.
- **Retention_Period**: A configurable span of time after a Store is offboarded during which the Control_Plane's records for that Store are retained and can be restored or exported before permanent purge.
- **MFA**: Multi-factor authentication; a second authentication factor required, when enabled, before a Control_Plane session is granted.
- **Platform_Analytics**: The Super_Admin-facing view of platform-level business metrics (for example Monthly Recurring Revenue, Store counts by Subscription_Status, new and churned Stores, and revenue by Subscription_Plan), computed from Control_Plane_Database records.
- **MRR**: Monthly Recurring Revenue; the normalized monthly recurring revenue across all active Stores derived from their Subscription_Plans.

## Requirements

### Requirement 1: Super Admin Authentication and Authorization

**User Story:** As a Super_Admin, I want a privileged control-plane operator role that is distinct from per-store admin access, so that only I can reach the Platform control plane.

#### Acceptance Criteria

1. THE Super_Admin_Service SHALL recognize a Super_Admin privilege tier for the Control_Plane that is distinct from any Store's Store_Admin (`requireAdmin`) tier.
2. THE Super_Admin_Service SHALL treat a Super_Admin credential as valid only when the credential is present, identifies the Super_Admin tier, is unexpired, and has not been revoked.
3. IF a request to a Control_Plane endpoint is made without a Super_Admin credential, THEN THE Super_Admin_Service SHALL respond with HTTP 403 and SHALL NOT execute the requested operation, leaving all target resources unchanged.
4. IF a request to a Control_Plane endpoint presents a credential that is expired, revoked, or malformed, THEN THE Super_Admin_Service SHALL respond with HTTP 403 and SHALL NOT execute the requested operation, leaving all target resources unchanged.
5. IF a requester who lacks the Super_Admin tier requests a Control_Plane endpoint, THEN THE Super_Admin_Service SHALL respond with HTTP 403 and SHALL NOT execute the requested operation.
6. WHEN a Super_Admin presents a valid Super_Admin credential to a Control_Plane endpoint, THE Super_Admin_Service SHALL execute the requested operation and return a success response indicating the operation completed.
7. THE Super_Admin_Service SHALL enforce Super_Admin authorization on the server for every Control_Plane endpoint, independent of any client-side UI gating.
8. THE Super_Admin_Service SHALL scope every Super_Admin operation to the Control_Plane and its own Control_Plane_Database, and SHALL NOT grant the Super_Admin direct access to any Store's database.
9. WHEN a request to a Control_Plane endpoint is denied for missing, invalid, expired, revoked, or insufficient-tier credentials, THE Super_Admin_Service SHALL record an audit entry capturing the attempted endpoint, the requesting identity (where determinable), and the denial reason.

### Requirement 2: Cross-Store Dashboard and Intel

**User Story:** As a Super_Admin, I want to view all store owners' websites, status, and metrics in one place, so that I can monitor the health of the Platform.

#### Acceptance Criteria

1. WHEN a Super_Admin opens the Store_Dashboard, THE Super_Admin_Service SHALL return a list of all Stores recorded in the Store_Registry including, for each Store, its name, Platform_Status, and Subscription_Status.
2. WHEN a Super_Admin opens the Store_Dashboard, THE Store_Dashboard SHALL display per-Store metrics obtained from each Store's Store_Metrics_Endpoint, including order count as a non-negative integer and revenue total as a monetary amount with two decimal places, for the selected time range.
3. WHERE a Store's Store_Metrics_Endpoint exposes a traffic count, THE Store_Dashboard SHALL display that traffic count as a non-negative integer for the selected time range.
4. WHEN a Super_Admin selects a single Store, THE Super_Admin_Service SHALL return that Store's detailed intel obtained from that Store's Store_Metrics_Endpoint, including order count as a non-negative integer, revenue total as a monetary amount with two decimal places, any exposed traffic count as a non-negative integer, and the Store's Subscription_Status.
5. WHERE a time range is provided by the Super_Admin, THE Super_Admin_Service SHALL request metrics restricted to that time range, treating both the start and end endpoints as inclusive.
6. WHERE no time range is provided by the Super_Admin, THE Super_Admin_Service SHALL request metrics over the most recent 30 days.
7. IF a Super_Admin provides a time range whose start is after its end, THEN THE Super_Admin_Service SHALL reject the request with HTTP 400 and SHALL return an error indication identifying the invalid time range.
8. THE Store_Dashboard SHALL support pagination of the Store list using the established `useAdminList()` / `DataTable` / `Pagination` patterns with a default page size of 20.
9. WHEN a Super_Admin opens the Store_Dashboard and no Stores are registered, THE Super_Admin_Service SHALL return an empty Store list.
10. IF a Store's Store_Metrics_Endpoint is unreachable or returns an error, THEN THE Super_Admin_Service SHALL return that Store's record with its Store_Registry fields and SHALL mark that Store's metric fields as unavailable rather than omitting the Store from the list.
11. THE Store_Dashboard SHALL render all labels and messages through i18n for locales `az`, `ru`, and `en`.

### Requirement 3: Store Suspension and Reactivation

**User Story:** As a Super_Admin, I want to suspend a non-paying Store and reactivate it when they pay, so that I can enforce the leasing agreement.

#### Acceptance Criteria

1. WHEN a Super_Admin suspends a Store, THE Suspension_Service SHALL set that Store's Platform_Status to `suspended` in the Store_Registry within 5 seconds of accepting the request.
2. WHEN a Super_Admin reactivates a suspended Store, THE Suspension_Service SHALL set that Store's Platform_Status to `active` in the Store_Registry within 5 seconds of accepting the request.
3. WHILE a Store's Platform_Status is `suspended`, THE Store SHALL enforce the suspension by checking its Platform_Status, blocking its Store_Admins from performing admin write operations (create, update, and delete), and responding with HTTP 403 to those operations.
4. WHILE a Store's Platform_Status is `suspended`, THE Store SHALL permit that Store's Store_Admins to perform admin read operations.
5. WHILE a Store's Platform_Status is `suspended`, THE Storefront for that Store SHALL display a suspended-state notice and SHALL reject completion of new orders.
6. WHEN a Super_Admin changes a Store's Platform_Status, THE Suspension_Service SHALL record the action in the Platform_Audit_Log with the acting Super_Admin identity, the Store identifier, the previous status, the new status, and the UTC timestamp of the action.
7. WHEN a Store is reactivated from `suspended` to `active`, THE Store SHALL restore its Storefront and admin access to the behavior in effect before suspension, preserving the Store's pre-suspension data, which the Store retains because the Control_Plane never modified it.
8. IF a Super_Admin attempts to suspend a Store that is already `suspended`, THEN THE Suspension_Service SHALL leave the Platform_Status unchanged and SHALL return a success response indicating the status is already `suspended`.
9. IF a Super_Admin attempts to reactivate a Store that is already `active`, THEN THE Suspension_Service SHALL leave the Platform_Status unchanged and SHALL return a success response indicating the status is already `active`.
10. IF a Super_Admin attempts to suspend or reactivate a Store identifier that does not exist in the Store_Registry, THEN THE Suspension_Service SHALL respond with HTTP 404, SHALL change no Store's Platform_Status, and SHALL return an error indication that the Store was not found.

### Requirement 4: Suspended-State Visitor and Admin Experience

**User Story:** As a Storefront visitor of a suspended Store, I want a clear, graceful page instead of a broken site, so that I understand the store is unavailable.

#### Acceptance Criteria

1. WHILE a Store's Platform_Status is `suspended`, WHEN a visitor requests that Store's Storefront, THE Store SHALL display a localized suspended-state notice that conveys the store is unavailable and SHALL exclude normal storefront content, including product listings, cart controls, and checkout actions.
2. WHILE a Store's Platform_Status is `suspended`, THE Store SHALL render the suspended-state notice through i18n in the locale selected from the active storefront locale prefix among `az`, `ru`, and `en`.
3. IF the active storefront locale is undefined or unsupported, THEN THE Store SHALL render the suspended-state notice in the default locale `az`.
4. WHILE a Store's Platform_Status is `suspended`, IF a visitor attempts to submit an order for that Store, THEN THE Store SHALL reject the order as a single observable outcome in which the visitor receives an HTTP 403 error response indicating the store is unavailable while no order record is created or modified and no stock is decremented, such that delivery of the rejection and the absence of any order record are guaranteed together.
5. WHILE a Store's Platform_Status is `suspended`, WHEN a visitor requests that Store's Storefront, THE Store SHALL return HTTP 503 for the suspended-state notice.

### Requirement 5: Store Lifecycle Management

**User Story:** As a Super_Admin, I want to create, onboard, and disable Stores in the Store_Registry, so that I can manage the roster of leased stores.

#### Acceptance Criteria

1. WHEN a Super_Admin submits a Store creation request containing a name of 1 to 120 characters, an initial owner contact email, the Store's instance URL, its Store_Metrics_Endpoint location, and a Per_Store_Credential reference, THE Super_Admin_Service SHALL create the Store_Registry record with Platform_Status `onboarding`.
2. WHEN a Super_Admin marks a Store whose current Platform_Status is `onboarding` as ready, THE Super_Admin_Service SHALL set the Store's Platform_Status to `active`.
3. IF a Super_Admin attempts a Platform_Status transition that is not permitted from the Store's current Platform_Status, THEN THE Super_Admin_Service SHALL reject the request with HTTP 409, SHALL leave the Store's Platform_Status unchanged, and SHALL return an error indicating the invalid transition.
4. WHEN a Super_Admin disables a Store, THE Super_Admin_Service SHALL set the Store's Platform_Status to `disabled` in the Store_Registry.
5. WHILE a Store's Platform_Status is `disabled`, THE Store SHALL deny every Storefront and admin access request and SHALL return an error indicating the Store is disabled.
6. IF a Super_Admin submits a Store creation request with a name that matches an existing Store name using case-insensitive comparison, THEN THE Super_Admin_Service SHALL reject the request with HTTP 409 and SHALL not create a new Store_Registry record.
7. IF a Super_Admin submits a Store creation request that is missing a required field or contains a field that fails schema validation, THEN THE Super_Admin_Service SHALL reject the request with HTTP 400 and SHALL identify each offending field by name.
8. WHEN a Super_Admin changes a Store's Platform_Status through lifecycle management, THE Super_Admin_Service SHALL record an entry in the Platform_Audit_Log that includes the acting Super_Admin identity, the affected Store identity, the prior Platform_Status, the new Platform_Status, and the timestamp of the action.
9. WHEN a Super_Admin submits any Store lifecycle request body, THE Super_Admin_Service SHALL validate it using the established `validate(schema)` Zod middleware pattern before applying any state change.
10. THE Super_Admin_Service SHALL treat creating a Store as recording its Store_Registry entry (instance URL, Store_Metrics_Endpoint, Per_Store_Credential reference, and status) and SHALL NOT require automated provisioning of the Store instance infrastructure, which may be performed manually.

### Requirement 6: Subscription and Payment Status Tracking

**User Story:** As a Super_Admin, I want to track each Store's subscription and payment status in the Control_Plane, so that I know which Stores to suspend or reactivate.

#### Acceptance Criteria

1. THE Super_Admin_Service SHALL maintain exactly one Subscription_Status for each Store in the Control_Plane_Database, drawn from the set `trialing`, `active`, `past_due`, or `cancelled`.
2. WHEN a Super_Admin creates a Store, THE Super_Admin_Service SHALL set that Store's initial Subscription_Status to `trialing`.
3. WHEN a Super_Admin updates a Store's Subscription_Status to a value within the defined set, THE Super_Admin_Service SHALL persist the new status in the Control_Plane_Database.
4. WHEN a Super_Admin updates a Store's Subscription_Status to a value within the defined set, THE Super_Admin_Service SHALL record an entry in the Platform_Audit_Log that includes the affected Store identity, the acting Super_Admin identity, the previous Subscription_Status, the new Subscription_Status, and the timestamp of the action.
5. WHEN a Super_Admin views the Store_Dashboard, THE Store_Dashboard SHALL display each Store's current Subscription_Status.
6. WHEN a Super_Admin requests Stores filtered by Subscription_Status, THE Super_Admin_Service SHALL return only the Stores whose Subscription_Status matches the requested value.
7. WHEN a Super_Admin requests Stores filtered by a Subscription_Status that no Store matches, THE Super_Admin_Service SHALL return an empty Store list.
8. IF a Super_Admin submits a Subscription_Status update request that fails validation because the Subscription_Status value is outside the defined set, because the request body is malformed, or because the Store identifier is missing or invalid, THEN THE Super_Admin_Service SHALL reject the request with HTTP 400, SHALL leave the Store's existing Subscription_Status unchanged, and SHALL return an error indication identifying the offending field or value.
9. WHEN a Super_Admin submits a Subscription_Status update request, THE Super_Admin_Service SHALL validate the request body using the established `validate(schema)` Zod middleware pattern and SHALL produce the outcome as a single atomic result in which either the new Subscription_Status is fully persisted on success or the request fully fails with both an HTTP 400 status and its error indication, never a partial result where the status changes without the error indication or the error indication is returned while the status changes.
10. THE Super_Admin_Service SHALL allow a Super_Admin to record an Invoice as paid manually, and SHALL treat automated billing transitions as additive to this manual capability rather than a replacement for it.

### Requirement 7: Store Notification Feed

**User Story:** As a Store_Admin, I want my store's admin panel to show platform notifications addressed to my store, so that I stay informed of messages from the Platform.

#### Acceptance Criteria

1. WHEN a Store's admin panel fetches notifications from the Control_Plane notification-fetch endpoint using that Store's Per_Store_Credential, THE Notification_Service SHALL return only the Notifications targeted at that Store and SHALL exclude every Notification targeted at any other Store.
2. THE Notification_Center SHALL display each fetched Notification with its content, creation time, and read/unread state.
3. WHEN a Store_Admin marks a Notification targeted at that Store as read, THE Notification_Service SHALL set that Notification's read state for that Store and SHALL preserve the read state across subsequent fetches.
4. IF a Store_Admin attempts to mark a Notification as read that does not exist or is not targeted at that Store, THEN THE Notification_Service SHALL respond with HTTP 404, SHALL preserve the existing read state of all Notifications, and SHALL return an error indication.
5. WHEN a Store's admin panel fetches notifications, THE Notification_Service SHALL return the count of unread Notifications for that Store as an integer greater than or equal to 0.
6. WHEN a Store's admin panel fetches notifications and no Notifications are targeted at that Store, THE Notification_Service SHALL return an empty Notification list and an unread count of 0.
7. THE Notification_Center SHALL render all labels and notification-chrome strings through i18n for locales `az`, `ru`, and `en`, with no untranslated key and no empty string rendered for any of those locales.
8. WHEN a Store's admin panel fetches notifications, THE Notification_Service SHALL order them by creation timestamp descending, breaking ties deterministically by the Notification's unique identifier.
9. THE Notification_Service SHALL treat Store_Event_Notifications as a store-local concern outside the Control_Plane scope and SHALL NOT require the Control_Plane to generate or store any Store_Event_Notification.

### Requirement 8: Super Admin Notification Broadcasting and Targeting

**User Story:** As a Super_Admin, I want to send messages to one Store, several Stores, or all Stores, so that I can communicate with store owners.

#### Acceptance Criteria

1. WHEN a Super_Admin sends a Platform_Message targeted at a specific Store whose Platform_Status is not `disabled`, THE Notification_Service SHALL create a Notification targeted only at that Store and deliver it to that Store's notification feed.
2. WHEN a Super_Admin sends a Platform_Message targeted at a set of 2 to 1000 Stores, THE Notification_Service SHALL create Notifications targeted only at the Stores in that set.
3. WHEN a Super_Admin broadcasts a Platform_Message to all Stores, THE Notification_Service SHALL create a Notification targeted at every Store whose Platform_Status is not `disabled`.
4. WHEN a Super_Admin sends a Platform_Message, THE Notification_Service SHALL record the send action in the Platform_Audit_Log with the target scope (single Store, set of Stores, or broadcast), the Super_Admin identity, and the timestamp before returning a success response.
5. IF a Super_Admin sends a Platform_Message whose content is empty, whitespace-only, or longer than 5000 characters, THEN THE Notification_Service SHALL reject the request with HTTP 400, SHALL create no Notification, and SHALL return an error indication.
6. IF a Super_Admin targets a Platform_Message at a target set containing any Store identifier that does not exist in the Store_Registry, THEN THE Notification_Service SHALL reject the entire request with HTTP 404 and SHALL create no Notifications.
7. IF a request to send a Platform_Message is made by a requester who is not a Super_Admin, THEN THE Notification_Service SHALL reject the request with HTTP 403 and SHALL create no Notification.
8. WHEN a Super_Admin sends a Platform_Message, THE Notification_Service SHALL make the Notification fetchable only by the targeted Stores and by no other Store.

### Requirement 9: Physical Store Isolation

**User Story:** As the Platform owner, I want strict physical isolation between Stores and the Control_Plane, so that no store's data can ever be read or modified through another store or through the control plane.

#### Acceptance Criteria

1. THE Control_Plane SHALL NOT access any Store's domain database directly, and SHALL interact with a Store only through that Store's authenticated Store_Metrics_Endpoint and notification-fetch endpoint.
2. WHEN the Control_Plane requests intel from a Store, THE Control_Plane SHALL authenticate to that Store's endpoint using that Store's Per_Store_Credential and SHALL store at most cached aggregate numbers, never any of the Store's raw records.
3. WHEN a Store receives a request bearing a Per_Store_Credential that belongs to a different Store, THE Store SHALL reject the request and SHALL return no data.
4. WHEN a Store responds to an authenticated Control_Plane request, THE Store SHALL return only that Store's own aggregate data and SHALL NOT return any other Store's data, because each Store's data resides in a separate database.
5. THE Store_Metrics_Endpoint SHALL expose only aggregate numbers about its own Store and SHALL NOT expose raw store records such as individual orders, customers, or products.
6. IF a request to a Store's Control_Plane-facing endpoint arrives without a valid Per_Store_Credential, THEN THE Store SHALL reject the request, SHALL return no data, and SHALL provide an error indication that authentication is required.
7. THE Platform SHALL ensure that cross-store data exposure is structurally prevented by maintaining each Store's data in its own separate database with no shared data store between Stores and no shared data store between any Store and the Control_Plane.
8. THE Control_Plane_Database SHALL hold only platform-owner data (the Store_Registry, subscription, plan, billing, invoice, platform notification, and audit records) and cached aggregate numbers, and SHALL NOT hold any Store's raw domain records.

### Requirement 10: Support Impersonation and Read-Only Store Access

**User Story:** As a Super_Admin, I want time-bounded read-only access to a single Store for support, so that I can diagnose issues without altering store data and without direct database access.

#### Acceptance Criteria

1. WHEN a Super_Admin starts an Impersonation session for a Store that exists in the Store_Registry, THE Super_Admin_Service SHALL grant read-only support access to that Store through that Store's authenticated endpoint or a generated support link within 2 seconds and SHALL record the session start in the Platform_Audit_Log with the acting Super_Admin identity, the accessed Store identity, and the session start timestamp.
2. IF a Super_Admin attempts to start an Impersonation session for a Store identifier that does not exist or that the Super_Admin is not authorized to access, THEN THE Super_Admin_Service SHALL reject the request, SHALL grant no access, SHALL return an error indication, and SHALL record the rejected attempt in the Platform_Audit_Log.
3. WHILE an Impersonation session is active, IF a write operation (create, update, or delete) is attempted within the session, THEN THE access SHALL be rejected with HTTP 403, the target data SHALL be left unchanged, and an error indication SHALL be returned.
4. WHILE an Impersonation session is active, THE Super_Admin_Service SHALL restrict the session's access to the single accessed Store through that Store's endpoint and SHALL deny any access to another Store within the session.
5. WHEN an Impersonation session reaches its time bound of 60 minutes measured from session start, THE Super_Admin_Service SHALL terminate the session within 5 seconds and SHALL record the session end in the Platform_Audit_Log with the accessed Store identity, the session end timestamp, and a termination reason of time-bound expiry.
6. WHEN a Super_Admin ends an Impersonation session, THE Super_Admin_Service SHALL terminate the session, SHALL revoke the read-only access granted by that session within 5 seconds, and SHALL record the session end in the Platform_Audit_Log with the accessed Store identity, the session end timestamp, and a termination reason of Super_Admin action.
7. WHEN a request is made using an Impersonation session that has ended, THE Super_Admin_Service SHALL reject the request and SHALL grant no access to the previously accessed Store.

### Requirement 11: Platform Audit Logging

**User Story:** As a Super_Admin, I want every platform action recorded, so that I have an accountable history of control-plane changes.

#### Acceptance Criteria

1. WHEN a Super_Admin performs a control-plane mutation, THE Super_Admin_Service SHALL write exactly one Platform_Audit_Log entry recording the acting Super_Admin identity, the action, the affected Store, the recorded timestamp, and the change details (the before state and after state of the mutated fields), using the established `writeAudit()` mechanism.
2. WHEN a Platform_Audit_Log entry is written for a Super_Admin action, THE Super_Admin_Service SHALL set on that entry an observable platform-scope marker that separates Control_Plane entries from any Store's local audit entries.
3. WHEN a Super_Admin requests the Platform_Audit_Log, THE Super_Admin_Service SHALL return entries ordered by recorded timestamp with the most recent entry first, returning at most 100 entries per request.
4. WHEN a Super_Admin requests the Platform_Audit_Log filtered by a valid Store, THE Super_Admin_Service SHALL return only entries affecting that Store, and SHALL return an empty result when no entries match that Store.
5. IF a Super_Admin requests the Platform_Audit_Log with a missing or invalid Store filter input, THEN THE Super_Admin_Service SHALL reject the request with an error indication and SHALL return no entries.
6. IF writing a Platform_Audit_Log entry fails, THEN THE Super_Admin_Service SHALL complete the requested control-plane operation without surfacing an error to the Super_Admin, consistent with the existing fire-and-forget audit behavior.

### Requirement 12: Internationalization of Platform Surfaces

**User Story:** As a Super_Admin and as a Store_Admin, I want all platform and notification text localized, so that the interfaces match the Azerbaijan market's languages.

#### Acceptance Criteria

1. THE Store_Dashboard, Notification_Center, and suspended-state notice SHALL source every user-visible string through `useI18n()` `t(key)`, such that zero user-visible literals are rendered without a `t(key)` lookup.
2. THE Platform SHALL provide a non-empty message entry for every used string key in each of the `az`, `ru`, and `en` locale modules, with identical key sets across all three locales.
3. WHEN a Super_Admin or Store_Admin selects one of the three supported locales `az`, `ru`, or `en`, THE platform surfaces SHALL render their strings in that locale within 1 second.
4. THE platform surfaces SHALL persist the selected locale across navigation and page reload.
5. IF a string key is missing for the selected locale, THEN the platform surfaces SHALL fall back to the default locale `az` rather than displaying the raw key.
6. IF a string key is missing in both the selected locale and the default locale `az`, THEN the platform surfaces SHALL render a non-key placeholder and SHALL NOT render the raw key.

### Requirement 13: Subscription Plans and Tiers

**User Story:** As a Super_Admin, I want to define named Subscription_Plans and assign each Store to one, so that I can offer tiered leasing packages with distinct prices and limits.

#### Acceptance Criteria

1. WHEN a Super_Admin submits a Subscription_Plan creation request containing a name of 1 to 120 characters, a price as a monetary amount with two decimal places in the range 0.00 to 999,999,999.99, a Billing_Interval drawn from the defined set, a set of feature flags (each an enabled/disabled boolean capability), and a set of Quota limits (each a non-negative integer in the range 0 to 2,147,483,647), THE Super_Admin_Service SHALL create the Subscription_Plan in the Control_Plane_Database.
2. WHEN a Super_Admin submits a Subscription_Plan creation or edit request, THE Super_Admin_Service SHALL validate the request body using the established `validate(schema)` Zod middleware pattern before applying any change.
3. IF a Super_Admin submits a Subscription_Plan creation or edit request that is missing a required field or contains a field that fails schema validation, THEN THE Super_Admin_Service SHALL reject the request with HTTP 400, SHALL make no change to any Subscription_Plan, and SHALL identify each offending field by name.
4. IF a Super_Admin submits a Subscription_Plan creation request, or an edit request that renames a Subscription_Plan, with a name that matches an existing different Subscription_Plan name using case-insensitive comparison, THEN THE Super_Admin_Service SHALL reject the request with HTTP 409, SHALL not create or rename any Subscription_Plan, and SHALL return an error indication identifying the name collision.
5. WHEN a Super_Admin edits an existing Subscription_Plan, THE Super_Admin_Service SHALL persist the updated price, Billing_Interval, and limits.
6. WHEN a Super_Admin archives a Subscription_Plan that has no assigned Stores, THE Super_Admin_Service SHALL mark the Subscription_Plan as archived and SHALL exclude the archived Subscription_Plan from the set of plans available for new assignment.
7. THE Super_Admin_Service SHALL associate each Store with exactly one Subscription_Plan.
8. WHEN a Super_Admin assigns or changes a Store's Subscription_Plan to a Subscription_Plan that exists and is not archived, THE Super_Admin_Service SHALL persist the Store's new Subscription_Plan assignment.
9. IF a Super_Admin attempts to delete a Subscription_Plan that still has one or more assigned Stores, THEN THE Super_Admin_Service SHALL reject the request with HTTP 409, SHALL leave the Subscription_Plan and all assignments unchanged, and SHALL return an error indication that the Subscription_Plan has assigned Stores.
10. WHEN a Super_Admin creates, edits, archives, or deletes a Subscription_Plan, or changes a Store's Subscription_Plan assignment, THE Super_Admin_Service SHALL record an entry in the Platform_Audit_Log that includes the acting Super_Admin identity, the affected Subscription_Plan or Store identity, the prior value, the new value, and the timestamp of the action, using the established `writeAudit()` mechanism.
11. WHEN a Super_Admin opens the Store_Dashboard, THE Store_Dashboard SHALL display each Store's current Subscription_Plan distinctly from that Store's Subscription_Status.
12. THE Subscription_Plan management surfaces SHALL render all labels and messages through i18n for locales `az`, `ru`, and `en`.
13. IF a Super_Admin attempts to archive a Subscription_Plan that has one or more assigned Stores, THEN THE Super_Admin_Service SHALL reject the request with HTTP 409, SHALL leave the Subscription_Plan and all assignments unchanged, and SHALL return an error indication that the Subscription_Plan has assigned Stores.
14. IF a Super_Admin attempts to assign or change a Store's Subscription_Plan to a Subscription_Plan that does not exist or is archived, THEN THE Super_Admin_Service SHALL reject the request with HTTP 409, SHALL leave the Store's existing Subscription_Plan assignment unchanged, and SHALL return an error indication that distinguishes a not-found Subscription_Plan from an archived Subscription_Plan.

### Requirement 14: Automated Billing Lifecycle

**User Story:** As a Super_Admin, I want the Control_Plane to generate Invoices and drive billing status, so that non-paying Stores are suspended and paying Stores stay active, while I can still settle Invoices manually.

#### Acceptance Criteria

1. WHEN a Store's current Billing_Interval elapses, THE Super_Admin_Service SHALL generate exactly one Invoice for that Store for that Billing_Interval in the Control_Plane_Database within 60 minutes of the Billing_Interval boundary, with an issue date set to the Billing_Interval boundary date, a due date set to a configurable number of whole days in the range 1 to 90 (default 14) after the issue date, and an amount equal to the Store's Subscription_Plan price.
2. WHEN an Invoice is recorded as paid on or before its due date, THE Super_Admin_Service SHALL set the Store's Subscription_Status to `active` within 60 minutes of the payment being recorded.
3. IF an Invoice remains unpaid at the end of its due date, THEN THE Super_Admin_Service SHALL set the Store's Subscription_Status to `past_due` and SHALL start a Grace_Period for that Store beginning at the due date.
4. THE Super_Admin_Service SHALL use a configurable Grace_Period length expressed in whole days within the range 0 to 365 days (default 7 days), applying the configured value to all Stores for which no Store-specific override is set.
5. WHEN a Store's Grace_Period ends while the triggering Invoice remains unpaid, THE Super_Admin_Service SHALL automatically suspend the Store within 60 minutes of the Grace_Period end by setting the Store's Platform_Status to `suspended` using the Suspension_Service behavior defined in Requirement 3.
6. WHEN an Invoice is recorded as paid for a Store whose Subscription_Status is `past_due`, THE Super_Admin_Service SHALL set the Store's Subscription_Status to `active` and SHALL end any active Grace_Period for that Store within 60 minutes of the payment being recorded.
7. WHEN an Invoice is recorded as paid for a Store that was automatically suspended for non-payment, THE Super_Admin_Service SHALL automatically reactivate the Store within 60 minutes of the payment being recorded by setting the Store's Platform_Status to `active` using the Suspension_Service behavior defined in Requirement 3.
8. WHEN the Super_Admin_Service performs an automated Subscription_Status transition, an automated suspension, or an automated reactivation, THE Super_Admin_Service SHALL record an entry in the Platform_Audit_Log that includes the affected Store identity, an actor marker indicating the transition was automated, the prior value, the new value, and the timestamp, using the established `writeAudit()` mechanism.
9. WHERE a Super_Admin manually records an Invoice as paid or manually changes a Store's Subscription_Status or Platform_Status, THE Super_Admin_Service SHALL apply the manual change as an override of the automated lifecycle and SHALL record the override in the Platform_Audit_Log with the acting Super_Admin identity.
10. WHEN no Invoice is unpaid past its due date for a Store, THE Super_Admin_Service SHALL make no automated suspension for that Store.
11. IF generation of a Store's Invoice for a Billing_Interval fails, THEN THE Super_Admin_Service SHALL leave that Store's Subscription_Status and Platform_Status unchanged, SHALL record an entry in the Platform_Audit_Log indicating the generation failure and the affected Store identity using the established `writeAudit()` mechanism, and SHALL re-attempt generation of exactly one Invoice for that Billing_Interval on the next processing cycle.
12. IF an automated suspension or automated reactivation via the Suspension_Service does not complete successfully, THEN THE Super_Admin_Service SHALL leave the Store's Platform_Status unchanged and SHALL record an entry in the Platform_Audit_Log indicating the failure and the affected Store identity using the established `writeAudit()` mechanism.

### Requirement 15: Plan-Based Quota Limits and Enforcement

**User Story:** As a Super_Admin, I want each Subscription_Plan's Quotas recorded by the Control_Plane and enforced by each Store, so that Stores stay within the limits of the plan they pay for.

#### Acceptance Criteria

1. THE Super_Admin_Service SHALL derive each Store's effective Quotas from that Store's assigned Subscription_Plan and SHALL make those Quota limits available to the Store.
2. WHEN a Store queries its effective Quotas from the Control_Plane, THE Super_Admin_Service SHALL return, for each Quota, the Quota limit as a non-negative integer.
3. WHEN a Store_Admin requests a quota-bounded create operation for a Store whose current usage of the affected resource is strictly less than the Store's Quota for that resource, THE Store SHALL permit the operation and SHALL increase its recorded usage of that resource by the number of instances created.
4. IF a Store_Admin requests a quota-bounded create operation for a Store whose current usage of the affected resource is equal to or greater than the Store's Quota for that resource, THEN THE Store SHALL reject the operation with HTTP 403, SHALL make no change to the Store's data, and SHALL return an error indication identifying the exceeded Quota.
5. THE Store SHALL never block a read operation on the basis of any Quota.
6. WHEN a Store_Admin requests current Quota usage for that Store, THE Store SHALL return, for each Quota, the Quota limit and the current usage as non-negative integers within 2 seconds of the request.
7. WHEN a Super_Admin opens the Store_Dashboard, THE Store_Dashboard SHALL display each Store's Quota usage relative to that Store's Quota limits, using usage figures obtained from that Store's Store_Metrics_Endpoint.
8. WHEN a Super_Admin lowers a Subscription_Plan's Quota below the current usage of a Store assigned to that Subscription_Plan, THE Store SHALL retain its existing data without deletion.
9. WHILE a Store's current usage of a resource is equal to or greater than the Store's Quota for that resource, THE Store SHALL reject quota-bounded create operations for that resource with HTTP 403 until the Store's usage is strictly less than the Quota.
10. THE Quota usage surfaces SHALL render all labels and messages through i18n for locales `az`, `ru`, and `en`.
11. IF a Store has no assigned Subscription_Plan, THEN THE Store SHALL treat its effective Quota for every quota-bounded resource as zero and SHALL reject quota-bounded create operations with HTTP 403, making no change to the Store's data and returning an error indication identifying the exceeded Quota.
12. WHEN multiple quota-bounded create operations for the same Store and resource are processed simultaneously, THE Store SHALL ensure its recorded usage of that resource never exceeds the Store's Quota for that resource.

### Requirement 16: Store Offboarding and Data Retention

**User Story:** As a Super_Admin, I want a terminal offboarding path for cancelled Stores with a retention window, so that the Control_Plane's records for that Store can be recovered briefly but are ultimately purged and the store instance is handed off or torn down.

#### Acceptance Criteria

1. WHEN a Super_Admin initiates offboarding for a Store, THE Super_Admin_Service SHALL begin a Retention_Period of 30 calendar days for that Store's Control_Plane records and SHALL record the offboarding initiation in the Platform_Audit_Log with the acting Super_Admin identity, the affected Store identity, and the offboarding initiation timestamp.
2. WHEN a Super_Admin requests an export of an offboarded Store's Control_Plane records before that Store's Retention_Period ends, THE Super_Admin_Service SHALL produce a downloadable export of that Store's Control_Plane records within 60 seconds of the request.
3. WHEN a Super_Admin restores an offboarded Store before that Store's Retention_Period ends, THE Super_Admin_Service SHALL return the Store_Registry record to its pre-offboarding Platform_Status with its retained Control_Plane records intact and SHALL record the restoration in the Platform_Audit_Log with the acting Super_Admin identity, the affected Store identity, and the restoration timestamp.
4. WHEN a Store's Retention_Period ends, THE Super_Admin_Service SHALL permanently purge that Store's Control_Plane records and de-register the Store from the Store_Registry within 24 hours of the Retention_Period end.
5. WHILE a Store's Control_Plane records have been purged, IF a request to restore that Store is made, THEN THE Super_Admin_Service SHALL reject the request and SHALL return an error indication that the purged records are irrecoverable.
6. WHEN a Super_Admin requests a destructive purge of an offboarded Store, THE Super_Admin_Service SHALL require an explicit confirmation that identifies the target Store before performing the purge, and IF the confirmation is absent or does not match the target Store, THEN THE Super_Admin_Service SHALL reject the request and SHALL make no change to the Store's records.
7. WHEN a Super_Admin purges a Store, THE Super_Admin_Service SHALL record the purge in the Platform_Audit_Log with the acting Super_Admin identity, the purged Store identity, and the purge timestamp, and SHALL record the documented hand-off or teardown of the Store instance as a step distinct from the Control_Plane record purge.
8. WHEN a Store has been purged, THE Super_Admin_Service SHALL ensure that the purged Store's identifier is not reused for a different Store in a way that exposes any of the purged Store's prior Control_Plane records.
9. IF a Super_Admin requests an export of an offboarded Store's Control_Plane records after that Store's Retention_Period ends, THEN THE Super_Admin_Service SHALL reject the request and SHALL return an error indication that the Retention_Period has ended and the records are no longer available for export.

### Requirement 17: Super Admin Account Security and MFA

**User Story:** As the platform owner, I want the privileged Super_Admin account protected by multi-factor authentication and session limits, so that Control_Plane access is hard to compromise.

#### Acceptance Criteria

1. WHEN a Super_Admin account enrolls a second factor and the second factor is successfully verified, THE Super_Admin_Service SHALL record the account as having MFA enabled and SHALL invoke writeAudit() to record the enrollment in the Platform_Audit_Log with the account identity and the timestamp within 5 seconds of the successful verification.
2. IF a Super_Admin account submits a second factor for enrollment that fails verification, THEN THE Super_Admin_Service SHALL NOT record the account as having MFA enabled, SHALL return an error indication that second-factor verification failed, and SHALL invoke writeAudit() to record the failed enrollment attempt in the Platform_Audit_Log with the account identity and the timestamp.
3. WHILE MFA is required for Control_Plane access, WHEN a Super_Admin account attempts to begin a Control_Plane session, THE Super_Admin_Service SHALL grant the session only after a valid second factor has been presented.
4. WHILE MFA is required for Control_Plane access, IF a Control_Plane session is requested without a valid second factor, THEN THE Super_Admin_Service SHALL deny the session, SHALL NOT establish any Control_Plane session state, and SHALL return an error indication that a second factor is required.
5. WHEN a Control_Plane session reaches its configured maximum lifetime of 8 hours from session start, or remains idle (no authenticated Control_Plane request) for its configured idle timeout of 15 minutes, THE Super_Admin_Service SHALL terminate the session and SHALL require a new sign-in with a valid second factor before granting further Control_Plane access.
6. WHEN a Super_Admin account completes a Control_Plane sign-in attempt, THE Super_Admin_Service SHALL invoke writeAudit() to record the sign-in event in the Platform_Audit_Log within 5 seconds of the attempt completing, with the account identity, the outcome as one of {success, failure}, and the timestamp.
7. THE Super_Admin_Service SHALL enforce the MFA requirement (criteria 3 and 4) and the session lifetime and idle-timeout requirement (criterion 5) on the server for every Control_Plane access request, independent of and without reliance on any client-side gating.

### Requirement 18: Multi-Channel Notification Delivery (Email)

**User Story:** As a store owner, I want critical platform and billing notifications delivered by email as well as in my store's notification feed, so that I receive them even when my store is suspended.

#### Acceptance Criteria

1. WHEN the Notification_Service creates a Notification of a type designated for multi-channel delivery, THE Notification_Service SHALL initiate delivery of the Notification both to the targeted Store's notification feed and by email to the Store's owner contact within 60 seconds of the Notification's creation.
2. WHILE a Store's Platform_Status is `suspended`, WHEN the Notification_Service creates a billing or suspension Notification for that Store, THE Notification_Service SHALL deliver the Notification by a channel reachable while the Store is suspended, including email sent by the Control_Plane to the Store's owner contact independently of the Store instance.
3. WHEN a store owner sets a per-Store or per-type delivery preference for a notification type, THE Notification_Service SHALL apply that preference to every Notification of that type created after the preference is saved, except for notification types designated as mandatory.
4. WHEN the Notification_Service attempts delivery of a Notification on a channel, THE Notification_Service SHALL record the delivery attempt and its outcome for that channel as one of {succeeded, failed}.
5. WHEN the Notification_Service sends an email Notification, THE Notification_Service SHALL render the email content through i18n in the recipient Store's selected locale among `az`, `ru`, and `en`.
6. IF the recipient Store has no selected locale or an unsupported locale, THEN THE Notification_Service SHALL render the email content in the default locale `az`.
7. IF an email delivery attempt fails, THEN THE Notification_Service SHALL record the failed outcome and SHALL preserve the Notification in the Store's notification feed regardless of the email outcome.
8. IF a store owner sets a delivery-suppression preference for a notification type designated as mandatory, THEN THE Notification_Service SHALL reject or ignore the suppression preference and SHALL continue to deliver Notifications of that mandatory type.
9. IF an email delivery attempt for a Notification fails, THEN THE Notification_Service SHALL make up to 3 additional delivery attempts spaced at least 60 seconds apart, and SHALL preserve the Notification in the Store's notification feed regardless of whether any retry succeeds.
10. IF the recipient Store's owner contact email is missing or malformed, THEN THE Notification_Service SHALL not attempt email delivery, SHALL record an error indication identifying the missing or malformed owner contact email, and SHALL preserve the Notification in the Store's notification feed.

### Requirement 19: Platform Revenue and Business Analytics

**User Story:** As a Super_Admin, I want platform-level business metrics computed from Control_Plane records, so that I can understand revenue and Store trends distinct from per-store metrics.

#### Acceptance Criteria

1. WHEN a Super_Admin opens the Platform_Analytics view, THE Super_Admin_Service SHALL return the Monthly Recurring Revenue as a monetary amount in the platform billing currency with exactly two decimal places, the count of Stores whose Subscription_Status is `active`, the count whose Subscription_Status is `past_due`, and the count whose Subscription_Status is `cancelled`, each as a non-negative integer.
2. WHEN a Super_Admin opens the Platform_Analytics view, THE Super_Admin_Service SHALL return the count of new Stores over the selected period (Stores whose creation timestamp falls within the period) and the count of churned Stores over the selected period (Stores whose Subscription_Status transitioned to `cancelled` within the period), each as a non-negative integer.
3. WHEN a Super_Admin opens the Platform_Analytics view, THE Super_Admin_Service SHALL return revenue grouped by Subscription_Plan, with each group's revenue as a monetary amount in the platform billing currency with exactly two decimal places.
4. WHERE a period is provided by the Super_Admin with a length of at least 1 day and at most 366 days, THE Super_Admin_Service SHALL compute the metrics restricted to that period, treating both the start and end endpoints as inclusive.
5. WHERE no period is provided by the Super_Admin, THE Super_Admin_Service SHALL compute the metrics over the most recent 30 days.
6. IF a Super_Admin provides a period whose start is after its end, THEN THE Super_Admin_Service SHALL reject the request with HTTP 400, SHALL return no Platform_Analytics figures, and SHALL return an error indication identifying the invalid period.
7. IF a Super_Admin provides a period that is missing the start endpoint or the end endpoint, contains a non-date value for either endpoint, or exceeds 366 days in length, THEN THE Super_Admin_Service SHALL reject the request with HTTP 400, SHALL return no Platform_Analytics figures and no partial data, and SHALL return an error indication identifying the invalid period.
8. THE Super_Admin_Service SHALL derive all Platform_Analytics figures only from persisted Control_Plane records (Store_Registry, Subscription_Plan, and Invoice records), excluding any synthetic, sample, or placeholder data and excluding any Store's raw domain records.
9. WHEN a Super_Admin opens the Platform_Analytics view and no Stores exist within the selected period, THE Super_Admin_Service SHALL return an explicit value of 0 for every Platform_Analytics figure scoped to that period.
10. WHEN a Super_Admin opens the Platform_Analytics view, THE Super_Admin_Service SHALL return the requested Platform_Analytics figures within 3 seconds for at least 95% of requests.
11. THE Platform_Analytics view SHALL render all labels and messages through i18n for locales `az`, `ru`, and `en`.
