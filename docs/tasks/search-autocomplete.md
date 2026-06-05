# Search with Autocomplete & Suggestions

## What & Why
The current search bar submits a full page and queries Supabase with a basic `ilike` filter. Competitors show instant suggestions as you type — product names, category matches, popular searches. This dramatically improves search conversion and reduces zero-result frustration. The search input is already prominently placed in the header; it just needs to become intelligent.

## Done looks like
- As the user types in the search bar (after 2+ characters), a dropdown appears within ~300ms showing up to 6 product suggestions with thumbnail + name + price
- Category matches are shown in a separate "Kateqoriyalar" section of the dropdown (up to 3)
- Selecting a suggestion navigates directly to that product/category page
- Pressing Enter or clicking "Hamısına bax" navigates to the full search results page with the query
- Zero-result state shows "Nəticə tapılmadı" with a link to browse all products
- Search results page (existing `SearchPage`) gets the same relevance improvements: results ordered by match quality (title match > description match), shows total result count
- Works in Azerbaijani, Russian, and English (searches across all translated titles)

## Out of scope
- AI semantic search / vector embeddings (future)
- Search analytics / popular queries dashboard
- Spell correction / fuzzy matching

## Steps
1. **Autocomplete API endpoint** — Add `GET /search/suggest?q=...&locale=az` that queries product_translations and category_translations with `ilike '%query%'`; returns top 6 products (id, slug, title, price, image) and top 3 categories (slug, title); debounce at the DB level with a LIMIT
2. **Dropdown component** — Build a `SearchSuggestions` dropdown component that renders the suggestion results below the search input; handles keyboard navigation (↑↓ arrows, Enter to select, Escape to close); closes on outside click
3. **Wire into Header search** — Update the search input in `Header.tsx` to call the suggest endpoint on input change (debounced 250ms); show `SearchSuggestions` dropdown; maintain existing form-submit behaviour for the full search page
4. **Search results page improvements** — Update `SearchPage` to show total result count ("X nəticə tapıldı"), order by relevance (title matches first), and show a "Məhsul tapılmadı" empty state with a "Bütün məhsullara bax" link
5. **Category search inclusion** — Ensure the existing search page also shows a "Kateqoriyalar" section at the top if any categories match the query

## Relevant files
- `artifacts/store/src/components/storefront/Header.tsx`
- `artifacts/store/src/pages/storefront/SearchPage.tsx`
- `artifacts/api-server/src/routes/index.ts`
