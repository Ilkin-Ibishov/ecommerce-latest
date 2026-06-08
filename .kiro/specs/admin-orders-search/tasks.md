# Implementation Plan

## Overview

Add a debounced search input to the admin orders page that filters by customer name or phone using Supabase `ilike` with trigram indexes. Combines with existing status filter tabs via AND logic. Persists search term in URL query parameter.

## Tasks

- [x] 1. Add trigram indexes migration
  - Create GIN trigram indexes on `orders(customer_name)` and `orders(customer_phone)` using `pg_trgm` extension
  - _Requirements: 3.7_

- [x] 2. Implement search input UI with debounce
  - Add search input above status filter tabs in `OrdersPage.tsx`
  - Magnifier icon on left, clear button on right when non-empty
  - 300ms debounce before triggering query
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2_

- [x] 3. Implement Supabase ilike query with OR logic
  - Apply `ilike('%term%')` on `customer_name` OR `customer_phone`
  - Combine with active status filter using AND logic
  - Reset page to 1 on search change
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 8.1, 8.2, 8.3_

- [x] 4. Add result count display and empty state
  - Show "N result(s) for 'term'" when searching
  - Show "No orders found for 'term'" when empty
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_

- [x] 5. URL state persistence
  - Sync debounced search to `?q=` query parameter
  - Restore search from URL on page load
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

## Notes

- Implemented as part of Admin Sprint 1 (commit fd0c200)
- All requirements satisfied and verified via typecheck + build
