# Super Admin Platform — Future Functionalities Backlog

Functionality that has been scoped but is intentionally **deferred** — not implemented in the current spec. These were fully drafted as requirements and moved here for future implementation. When picking one up, move its section back into `requirements.md` (renumbering accordingly), restore the related glossary terms, then proceed through design and tasks.

---

## Deferred 1: Platform Staff Roles and Permissions (RBAC)

**Status:** Deferred — not in current scope.

**Rationale for deferral:** The platform launches with a single platform owner (root Super_Admin). Delegating scoped access to additional staff is valuable once the operation grows, but is not required for initial launch. Until then, the single Super_Admin tier defined in Requirement 1 is sufficient.

**Glossary terms this reintroduces:**
- **Platform_Staff**: A platform-level operator account, other than the root Super_Admin, that is granted a Role limited to a set of Permissions for control-plane actions.
- **Role**: A named bundle of Permissions assignable to a Platform_Staff account.
- **Permission**: A discrete capability that authorizes a specific class of control-plane action (for example view-only, support-impersonate, billing, suspend/reactivate, manage-staff).

### Requirement: Platform Staff Roles and Permissions (RBAC)

**User Story:** As the platform owner, I want to invite Platform_Staff and grant each a Role of Permissions, so that I can delegate control-plane work without sharing full owner access.

#### Acceptance Criteria

1. THE Super_Admin_Service SHALL grant the root Super_Admin (the platform owner) all Permissions.
2. WHEN the root Super_Admin, or a Platform_Staff member holding a manage-staff Permission, invites a Platform_Staff account and assigns it a Role composed of a set of recognized Permissions, THE Super_Admin_Service SHALL create the Platform_Staff account with exactly the assigned recognized Permissions and no other Permissions.
3. THE Super_Admin_Service SHALL authorize each control-plane action against the acting account's Permissions, granting the action only when the acting account holds the Permission required for that action.
4. IF an account attempts a control-plane action for which it lacks the required Permission, THEN THE Super_Admin_Service SHALL reject the request with HTTP 403, SHALL not perform the action, and SHALL return an error indication.
5. WHEN the root Super_Admin, or a Platform_Staff member holding a manage-staff Permission, creates a Platform_Staff account, removes a Platform_Staff account, or changes a Platform_Staff account's Role or Permissions, THE Super_Admin_Service SHALL persist the change and SHALL record it in the Platform_Audit_Log using the established `writeAudit()` mechanism with the acting identity, the affected Platform_Staff identity, the prior Permissions, the new Permissions, and the timestamp.
6. IF an account that lacks a manage-staff Permission attempts to invite, modify, or remove a Platform_Staff account, THEN THE Super_Admin_Service SHALL reject the request with HTTP 403 and SHALL make no change to any Platform_Staff account.
7. WHEN a Platform_Staff account presents a valid credential to a control-plane endpoint for which it holds the required Permission, THE Super_Admin_Service SHALL execute the requested operation and return a success response.
8. THE Super_Admin_Service SHALL recognize the Super_Admin privilege tier defined in Requirement 1 as encompassing the root Super_Admin and Permission-limited Platform_Staff accounts consistently.
9. IF a Platform_Staff member holding a manage-staff Permission attempts to grant a Permission that the acting member does not itself hold, THEN THE Super_Admin_Service SHALL reject the request with HTTP 403, SHALL make no change to any Platform_Staff account, and SHALL return an error indication.
10. IF a request attempts to remove the root Super_Admin account or to revoke any Permission from the root Super_Admin, THEN THE Super_Admin_Service SHALL reject the request, SHALL make no change to the root Super_Admin account, and SHALL return an error indication.
11. IF an invite or Permission-assignment request references a Role or Permission that is not recognized, THEN THE Super_Admin_Service SHALL reject the request, SHALL create or change no Platform_Staff account, and SHALL return an error indication identifying the unrecognized Role or Permission.

---

## Deferred 2: Two-Way Support Messaging

**Status:** Deferred — not in current scope.

**Rationale for deferral:** One-way platform notifications (Super Admin → Store Admin) ship in the current spec. Letting store admins reply, turning the inbox into a support channel, is a valuable enhancement but not required for launch. Note this functionality depends in part on Platform_Staff/Permissions (also deferred) for staff-side replies.

**Glossary terms this reintroduces:**
- **Support_Thread**: A tenant-scoped, threaded conversation that begins from a Platform_Message and to which a Store_Admin and the Super_Admin (or permitted Platform_Staff) can reply.

### Requirement: Two-Way Support Messaging

**User Story:** As a Store_Admin, I want to reply to Platform_Messages, so that the Notification_Center doubles as a support channel with the platform.

#### Acceptance Criteria

1. WHEN a Store_Admin submits a reply containing between 1 and 5,000 characters (after trimming leading and trailing whitespace) to a Platform_Message addressed to the Store_Admin's own Tenant, THE Notification_Service SHALL create a reply within a Support_Thread scoped to that Tenant.
2. WHEN a Super_Admin, or a Platform_Staff member with the required Permission, replies to a Support_Thread, THE Notification_Service SHALL add the reply to that Support_Thread and SHALL make it visible to the Tenant's Store_Admins.
3. WHEN a Store_Admin requests Support_Threads, THE Notification_Service SHALL return only Support_Threads scoped to the Store_Admin's own Tenant and SHALL exclude every Support_Thread scoped to any other Tenant.
4. IF a Store_Admin attempts to read or reply to a Support_Thread that is not scoped to the Store_Admin's own Tenant, THEN THE Notification_Service SHALL respond with HTTP 404, SHALL make no change to the Support_Thread, and SHALL return an error indication.
5. IF a reply submission has a body that is empty or whitespace-only after trimming, or exceeds 5,000 characters, THEN THE Notification_Service SHALL reject the reply, SHALL make no change to the Support_Thread, and SHALL return an error indication identifying the invalid reply body.
6. WHEN a Support_Thread has messages unread by the requesting party, THE Notification_Service SHALL return an unread indicator for that Support_Thread for both the Store_Admin side and the Super_Admin side independently.
7. WHEN a reply is added to a Support_Thread, THE Notification_Service SHALL record the responding identity and the timestamp and SHALL make the responding identity visible to the Super_Admin.
8. WHEN the Notification_Service returns the messages of a Support_Thread, THE Notification_Service SHALL order those messages by recorded timestamp in ascending order.
9. THE Support_Thread surfaces SHALL render all labels and chrome strings through i18n for locales `az`, `ru`, and `en`.
