# Requirements Document

## Introduction

The admin orders list (`/admin/orders`) currently supports pagination and status filter tabs, but provides no way to search for a specific order. As order volume grows, admins need to locate orders quickly by customer phone number (the most common lookup) or customer name without scrolling through paginated results.

This feature adds a search input above the status filter tabs that filters the orders list in real-time using case-insensitive substring matching against the `customer_name` and `customer_phone` columns in the `orders` Supabase table. Search and status filters combine with AND logic. No new API routes are required — the existing direct Supabase PostgREST query is extended.

## Glossary

- **OrdersPage**: The admin page at `/admin/orders` (`artifacts/store/src/pages/admin/OrdersPage.tsx`) that lists all orders with pagination and status filter tabs.
- **Search_Input**: The text input field placed above the status filter tabs that accepts free-text queries.
- **Debounced_Search**: The internal state value that lags 300 ms behind the raw Search_Input value and drives the Supabase query.
- **Status_Filter**: The existing set of clickable tab buttons (All, pending, phone_verified, etc.) that filter orders by status.
- **Orders_Table**: The `orders` table in Supabase PostgreSQL, containing columns `customer_name` (text) and `customer_phone` (text) among others.
- **Result_Count**: A text element that displays the number of matching orders when a search is active.
- **Clear_Button**: An `×` icon button rendered inside the Search_Input when the input has a non-empty value; clicking it resets the search.

## Requirements

### Requirement 1: Search Input UI

**User Story:** As an admin, I want a search input above the status filter tabs, so that I can type a name or phone number to filter the orders list without navigating away.

#### Acceptance Criteria

1. THE OrdersPage SHALL render a Search_Input above the Status_Filter tabs.
2. THE Search_Input SHALL display a magnifier icon on its left side as a non-interactive visual indicator.
3. THE Search_Input SHALL display the hardcoded placeholder text "Search by name or phone…" when the field is empty. (The admin panel does not participate in the storefront i18n system; admin strings are hardcoded English throughout for consistency with the rest of the admin UI.)
4. IF the Search_Input has a non-empty value, THEN THE OrdersPage SHALL render a Clear_Button inside the Search_Input on the right side.
5. WHEN the Clear_Button is clicked, THE OrdersPage SHALL set the Search_Input value to an empty string and remove the Clear_Button within the same render cycle.
6. WHEN the Search_Input value changes, THE OrdersPage SHALL use the entered text as the search term for case-insensitive substring matching against `customer_name` and `customer_phone`.

---

### Requirement 2: Debounced Query Trigger

**User Story:** As an admin, I want the search query to fire after I stop typing, so that the orders list does not make excessive network requests on every keystroke.

#### Acceptance Criteria

1. WHEN the Search_Input value changes, THE OrdersPage SHALL wait 300 ms after the last keystroke before updating the Debounced_Search value.
2. WHEN a new keystroke is received within 300 ms of the previous one, THE OrdersPage SHALL reset the 300 ms timer, discarding the pending update.
3. WHEN the Debounced_Search value changes to a non-empty string, THE OrdersPage SHALL execute a new filtered Supabase query against the Orders_Table using `ilike` on `customer_name` and `customer_phone`.
4. WHEN the Debounced_Search value changes to an empty string, THE OrdersPage SHALL execute a new unfiltered Supabase query against the Orders_Table, returning all orders subject only to the active Status_Filter.
5. WHEN the Debounced_Search value changes, THE OrdersPage SHALL reset the current page to 1 before the query executes.
6. WHEN the Supabase query fails, THE OrdersPage SHALL display an error message and retain the previously displayed order list.

---

### Requirement 3: Supabase Substring Search

**User Story:** As an admin, I want the search to match partial phone numbers and partial names, so that I can find orders by typing only a portion of the customer's details.

#### Acceptance Criteria

1. WHEN Debounced_Search is non-empty, THE OrdersPage SHALL apply an `ilike` filter on `customer_name` using the pattern `%{term}%` against the Orders_Table.
2. WHEN Debounced_Search is non-empty, THE OrdersPage SHALL apply an `ilike` filter on `customer_phone` using the pattern `%{term}%` against the Orders_Table.
3. THE OrdersPage SHALL combine the `customer_name` and `customer_phone` ilike filters with OR logic, returning orders that match either column.
4. IF Debounced_Search is empty or contains only whitespace, THEN THE OrdersPage SHALL omit the ilike filters and return the full unfiltered result set (subject to any active Status_Filter).
5. THE OrdersPage SHALL apply substring matching regardless of the stored phone prefix format, so that a search term of `501234567` matches `customer_phone` values such as `+994501234567` and `0501234567`.
6. WHEN filters return no rows, THE OrdersPage SHALL display an empty result set rather than an error state.
7. BEFORE this feature is deployed to production, a database migration SHALL create a GIN trigram index on `orders(customer_name)` and `orders(customer_phone)` using the `pg_trgm` extension, so that `ilike '%term%'` queries are index-backed and do not require a sequential scan at any order volume. The migration SHALL be: `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_customer_name_trgm_idx ON orders USING GIN (customer_name gin_trgm_ops); CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_customer_phone_trgm_idx ON orders USING GIN (customer_phone gin_trgm_ops);`

---

### Requirement 4: Combined Search and Status Filter

**User Story:** As an admin, I want search and the status filter tabs to work together, so that I can find, for example, all pending orders for a specific customer.

#### Acceptance Criteria

1. IF both Debounced_Search contains at least 1 non-whitespace character AND the Status_Filter is set to any value other than "All", THEN THE OrdersPage SHALL apply both filters to the Supabase query with AND logic, returning only orders that satisfy both conditions.
2. WHEN the Status_Filter is changed while Debounced_Search is non-empty, THE OrdersPage SHALL preserve the current search term and apply both filters in the new query.
3. WHEN Debounced_Search changes while a Status_Filter is active, THE OrdersPage SHALL preserve the active Status_Filter and apply both filters in the new query.
4. WHEN the Status_Filter is set to "All", THE OrdersPage SHALL omit the status equality filter from the query, regardless of the Debounced_Search value.
5. WHEN both filters are active and the combined query returns zero results, THE OrdersPage SHALL display an empty list with an informational message rather than an error state.

---

### Requirement 5: Result Count Display

**User Story:** As an admin, I want to see how many orders match my search, so that I know whether to refine my query.

#### Acceptance Criteria

1. WHEN Debounced_Search is non-empty, THE OrdersPage SHALL display a Result_Count message in the format `N result(s) for "{term}"` where N is the total count returned by the Supabase query and term is the Debounced_Search value.
2. WHEN Debounced_Search is empty, THE OrdersPage SHALL display the total order count in the format `N total` without a search term reference.
3. WHEN the Supabase query returns exactly 1 result, THE OrdersPage SHALL display "1 result for …" (singular, no trailing "s").
4. WHEN the Supabase query is loading and a previous Result_Count value exists, THE OrdersPage SHALL continue showing that previous value until the new result is available; if no previous value exists (initial load), THE OrdersPage SHALL show no count until the first result arrives.
5. WHEN the Supabase query fails, THE OrdersPage SHALL hide the Result_Count and display an error indicator instead.

---

### Requirement 6: Empty Search State

**User Story:** As an admin, I want a clear message when my search has no results, so that I know the search ran and found nothing rather than assuming a loading error.

#### Acceptance Criteria

1. WHEN Debounced_Search is non-empty and the Supabase query returns zero orders, THE OrdersPage SHALL display the message `No orders found for "{term}"` (with `{term}` truncated to 50 characters if longer) in the table body area.
2. WHEN Debounced_Search is empty and the Supabase query returns zero orders, THE OrdersPage SHALL display the message `No orders found.` in the table body area.
3. WHILE the Supabase query is loading, THE OrdersPage SHALL NOT display an empty-state message, showing a loading indicator instead to prevent premature "no results" display.
4. WHEN the Supabase query fails, THE OrdersPage SHALL display a query-failure error message in the table body area rather than a "no results" message.

---

### Requirement 7: URL State Persistence

**User Story:** As an admin, I want the search term to be reflected in the URL query string, so that I can bookmark, copy, or refresh the page and restore the same search state.

#### Acceptance Criteria

1. IF Debounced_Search is non-empty, THEN THE OrdersPage SHALL set the `q` query parameter in the URL to the Debounced_Search value using `replace` history mode.
2. IF Debounced_Search is empty, THEN THE OrdersPage SHALL remove the `q` query parameter from the URL using `replace` history mode.
3. WHEN the OrdersPage is loaded with a `q` query parameter present in the URL, THE OrdersPage SHALL initialise both the Search_Input value and the Debounced_Search value from the `q` parameter so that the orders list is filtered by that search term before any user interaction occurs.
4. IF the URL contains `?q=` with an empty string value on page load, THEN THE OrdersPage SHALL treat it as absent and initialise with an empty Debounced_Search.
5. WHEN both a `q` and a `status` query parameter are present in the URL on page load, THE OrdersPage SHALL restore both the search term and the Status_Filter before the first data fetch is initiated.
6. IF the URL contains a `status` query parameter with a value not in the set of valid statuses on page load, THEN THE OrdersPage SHALL default the Status_Filter to its default value ("All") and ignore the invalid parameter.

---

### Requirement 8: Pagination Reset on Search Change

**User Story:** As an admin, I want the results to start from the beginning whenever I change my search term, so that I never see an out-of-range page.

#### Acceptance Criteria

1. WHEN Debounced_Search changes to a new non-empty value, THE OrdersPage SHALL reset the `page` state variable to `1` without triggering a full page navigation or component remount — only the data-fetching logic re-runs with the new offset.
2. WHEN Debounced_Search is cleared (set to empty string), THE OrdersPage SHALL reset the `page` state variable to `1` and execute an unfiltered query from offset 0.
3. WHILE paginating through search results, THE OrdersPage SHALL preserve both the `q` and `status` query parameters in every page navigation link.
