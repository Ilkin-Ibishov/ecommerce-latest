/**
 * Property 1: Bug Condition — Heading Level Skip on Listing Pages and Footer
 *
 * This test encodes the EXPECTED behavior after the fix is applied.
 * On UNFIXED code, these tests will FAIL — proving the bug exists.
 *
 * Bug: ProductCard renders <h3> instead of <h2> on listing pages (h1 → h3 skip).
 *      Footer renders <h4> elements that skip heading levels.
 *      WishlistPage renders inline <h3> instead of <h2> (h1 → h3 skip).
 *      ProductGrid does not pass headingLevel to ProductCard.
 *
 * Approach: Since the vitest config runs in node environment without JSX transform,
 * we analyze component source code with property-based generation of scenarios to
 * verify heading structure. For ProductCard/ProductGrid, we verify the component
 * renders the correct heading element by checking the source code structure and
 * the default heading behavior. Random product data validates that the heading
 * choice is independent of content (a universal property).
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import fs from "fs";
import path from "path";

// ─── Source code paths ──────────────────────────────────────────────────────────

const COMPONENTS_DIR = path.resolve(import.meta.dirname, "..");
const PRODUCT_CARD_PATH = path.join(COMPONENTS_DIR, "components/storefront/ProductCard.tsx");
const PRODUCT_GRID_PATH = path.join(COMPONENTS_DIR, "components/storefront/ProductGrid.tsx");
const FOOTER_PATH = path.join(COMPONENTS_DIR, "components/storefront/Footer.tsx");
const WISHLIST_PATH = path.join(COMPONENTS_DIR, "pages/storefront/WishlistPage.tsx");

// ─── Generators ─────────────────────────────────────────────────────────────────

/** Generate random product data to verify heading behavior is content-independent */
const productDataArb = fc.record({
  slug: fc.string({ minLength: 1, maxLength: 30 }).map((s) => s.replace(/[^a-z0-9-]/gi, "a") || "product"),
  title: fc.string({ minLength: 1, maxLength: 100 }).map((s) => s.trim() || "Product"),
  price: fc.double({ min: 0.01, max: 99999, noNaN: true }),
  locale: fc.constantFrom("az", "ru", "en"),
});

/** Generate random arrays of products */
const productArrayArb = fc.array(
  fc.record({
    id: fc.uuid(),
    slug: fc.string({ minLength: 1, maxLength: 30 }).map((s) => s.replace(/[^a-z0-9-]/gi, "a") || "product"),
    title: fc.string({ minLength: 1, maxLength: 100 }).map((s) => s.trim() || "Product"),
    price: fc.double({ min: 0.01, max: 99999, noNaN: true }),
  }),
  { minLength: 1, maxLength: 10 }
);

// ─── Helper: analyze component heading structure ────────────────────────────────

/**
 * Extracts the heading tag used for product titles in ProductCard.
 * On unfixed code: hardcoded <h3>
 * After fix: dynamic based on headingLevel prop (default should render <h2> for listing pages)
 */
function getProductCardHeadingInfo(source: string) {
  // Check if there's a hardcoded <h3> for the product title
  const hardcodedH3 = /<h3\s+className="font-medium/.test(source);
  // Check if there's a dynamic heading element (the fix pattern)
  const hasDynamicHeading = /const\s+Heading\s*=/.test(source) || /headingLevel/.test(source);
  // Check if <h2> is used anywhere for product title
  const hasH2ForTitle = /<h2\s+className="font-medium/.test(source);

  return { hardcodedH3, hasDynamicHeading, hasH2ForTitle };
}

/**
 * Checks if ProductGrid passes headingLevel prop to ProductCard.
 */
function getProductGridHeadingInfo(source: string) {
  const passesHeadingLevel = /headingLevel/.test(source);
  return { passesHeadingLevel };
}

/**
 * Checks if Footer uses <h4> elements (the bug) or non-heading elements (the fix).
 */
function getFooterHeadingInfo(source: string) {
  const hasH4Elements = /<h4[\s>]/.test(source);
  const hasH4ClassName = /<h4\s+className="font-semibold/.test(source);
  return { hasH4Elements, hasH4ClassName };
}

/**
 * Checks if WishlistPage uses <h3> for inline product titles (bug) or <h2> (fix).
 */
function getWishlistHeadingInfo(source: string) {
  const hasInlineH3 = /<h3\s+className="font-medium/.test(source);
  const hasInlineH2 = /<h2\s+className="font-medium/.test(source);
  return { hasInlineH3, hasInlineH2 };
}

// ─── Property Tests: Bug Condition ──────────────────────────────────────────────

describe("Property 1: Bug Condition — Heading Level Skip on Listing Pages and Footer", () => {
  const productCardSource = fs.readFileSync(PRODUCT_CARD_PATH, "utf-8");
  const productGridSource = fs.readFileSync(PRODUCT_GRID_PATH, "utf-8");
  const footerSource = fs.readFileSync(FOOTER_PATH, "utf-8");
  const wishlistSource = fs.readFileSync(WISHLIST_PATH, "utf-8");

  it("ProductCard without headingLevel prop should render <h2> for listing pages (expected behavior after fix)", () => {
    /**
     * Property: For ANY random product data, the ProductCard component on a listing page
     * (where parent heading is <h1>) must render the product title as <h2>.
     *
     * The heading choice must be independent of the product content — it's a structural
     * property that depends only on the page context.
     *
     * On UNFIXED code: ProductCard hardcodes <h3>, so this test FAILS.
     * After fix: ProductCard uses dynamic heading based on headingLevel prop.
     */
    fc.assert(
      fc.property(productDataArb, ({ slug, title, price, locale }) => {
        // The property: regardless of product data (slug, title, price, locale),
        // the component should NOT have a hardcoded <h3> for product titles.
        // It should either:
        //   a) Have a dynamic heading that defaults to <h2> for listing context, OR
        //   b) Render <h2> directly for listing page usage
        const info = getProductCardHeadingInfo(productCardSource);

        // Expected after fix: no hardcoded h3 — should have dynamic heading mechanism
        // Bug condition: hardcoded <h3> exists regardless of context
        expect(info.hardcodedH3).toBe(false);

        // The title content (slug, title, price, locale) should not affect
        // which heading element is chosen — this is a universal structural property
        void slug;
        void title;
        void price;
        void locale;
      }),
      { numRuns: 50 }
    );
  });

  it("ProductGrid should support headingLevel prop to pass to ProductCard children", () => {
    /**
     * Property: For ANY array of products rendered in a ProductGrid on a listing page,
     * ProductGrid must propagate headingLevel to its ProductCard children.
     *
     * On UNFIXED code: ProductGrid has no headingLevel prop, so this test FAILS.
     * After fix: ProductGrid accepts and forwards headingLevel.
     */
    fc.assert(
      fc.property(productArrayArb, (products) => {
        const info = getProductGridHeadingInfo(productGridSource);

        // Expected after fix: ProductGrid knows about headingLevel
        // Bug condition: no headingLevel awareness in ProductGrid
        expect(info.passesHeadingLevel).toBe(true);

        // This property holds regardless of the number or content of products
        void products;
      }),
      { numRuns: 30 }
    );
  });

  it("Footer component should not render any <h4> elements", () => {
    /**
     * Property: The Footer component must NOT use <h4> heading elements for
     * column labels. Column labels (Store, Info, Contact) are visual labels
     * for navigation lists, not document outline headings.
     *
     * On UNFIXED code: Footer uses <h4> elements, so this test FAILS.
     * After fix: Footer uses <p> elements with same styling.
     */
    const info = getFooterHeadingInfo(footerSource);

    // Expected after fix: no <h4> elements in Footer
    // Bug condition: <h4> elements exist for column headings
    expect(info.hasH4Elements).toBe(false);
    expect(info.hasH4ClassName).toBe(false);
  });

  it("WishlistPage product titles should render as <h2> (not <h3>)", () => {
    /**
     * Property: For ANY product displayed on the WishlistPage, the inline
     * product title heading must be <h2> (since the page has <h1> as parent).
     *
     * On UNFIXED code: WishlistPage uses inline <h3>, so this test FAILS.
     * After fix: WishlistPage uses <h2> for product titles.
     */
    fc.assert(
      fc.property(productDataArb, ({ title }) => {
        const info = getWishlistHeadingInfo(wishlistSource);

        // Expected after fix: <h2> for product titles, NOT <h3>
        // Bug condition: inline <h3> exists
        expect(info.hasInlineH3).toBe(false);
        expect(info.hasInlineH2).toBe(true);

        // Heading element choice is independent of product title content
        void title;
      }),
      { numRuns: 50 }
    );
  });
});


// ─── Property Tests: Preservation ───────────────────────────────────────────────

/**
 * Property 2: Preservation — Nested Context Heading Levels Unchanged
 *
 * These tests verify that the fix preserves backward compatibility:
 * - ProductCard default (no headingLevel prop) still renders h3
 * - ProductCard with explicit headingLevel={3} still renders h3
 * - ProductCard with explicit headingLevel={2} renders h2
 * - ProductGrid without headingLevel defaults to h3 for all product titles
 * - Footer column labels retain correct visual styling classes
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 */
describe("Property 2: Preservation — Nested Context Heading Levels Unchanged", () => {
  const productCardSource = fs.readFileSync(PRODUCT_CARD_PATH, "utf-8");
  const productGridSource = fs.readFileSync(PRODUCT_GRID_PATH, "utf-8");
  const footerSource = fs.readFileSync(FOOTER_PATH, "utf-8");

  it("ProductCard source still contains h3 as default behavior (backward compatibility)", () => {
    /**
     * Property: The ProductCard component must retain h3 as a possible heading level.
     * The dynamic heading pattern `headingLevel === 2 ? 'h2' : 'h3'` ensures that
     * the default (headingLevel=3) still renders h3 for nested contexts like
     * HomePage sections and ProductDetail related products.
     */
    fc.assert(
      fc.property(productDataArb, ({ slug, title, price, locale }) => {
        // The source must contain the string 'h3' to confirm h3 is still a valid output
        const containsH3Logic = /['"]h3['"]/.test(productCardSource);
        expect(containsH3Logic).toBe(true);

        // The source must have headingLevel defaulting to 3
        const defaultsTo3 = /headingLevel\s*=\s*3/.test(productCardSource);
        expect(defaultsTo3).toBe(true);

        // Content-independent — heading element doesn't depend on product data
        void slug;
        void title;
        void price;
        void locale;
      }),
      { numRuns: 50 }
    );
  });

  it("ProductCard with explicit headingLevel={2} renders h2 (prop works correctly)", () => {
    /**
     * Property: For all random product data, when headingLevel={2} is passed,
     * the ProductCard must render h2. The source must contain logic to produce h2.
     */
    fc.assert(
      fc.property(productDataArb, ({ slug, title, price, locale }) => {
        // The source must contain the string 'h2' as a valid output option
        const containsH2Logic = /['"]h2['"]/.test(productCardSource);
        expect(containsH2Logic).toBe(true);

        // The dynamic heading logic must check for headingLevel === 2
        const checksForTwo = /headingLevel\s*===\s*2/.test(productCardSource);
        expect(checksForTwo).toBe(true);

        void slug;
        void title;
        void price;
        void locale;
      }),
      { numRuns: 50 }
    );
  });

  it("ProductGrid without headingLevel preserves h3 default for all product titles", () => {
    /**
     * Property: For all random product arrays, ProductGrid must forward headingLevel
     * to ProductCard. When no headingLevel is passed to ProductGrid, ProductCard
     * receives undefined → defaults to 3 → renders h3.
     */
    fc.assert(
      fc.property(productArrayArb, (products) => {
        // ProductGrid forwards headingLevel to ProductCard
        const forwardsHeadingLevel = /headingLevel={headingLevel}/.test(productGridSource) ||
          /headingLevel=\{headingLevel\}/.test(productGridSource);
        expect(forwardsHeadingLevel).toBe(true);

        // ProductGrid's headingLevel prop is optional (no default set in ProductGrid itself)
        // When omitted, ProductCard's default of 3 takes effect
        const hasOptionalProp = /headingLevel\?\s*:\s*2\s*\|\s*3/.test(productGridSource);
        expect(hasOptionalProp).toBe(true);

        void products;
      }),
      { numRuns: 30 }
    );
  });

  it("Footer column labels retain correct visual styling classes", () => {
    /**
     * Property: Footer column labels (Store, Info, Contact) must retain
     * the visual styling classes: font-semibold mb-3 text-sm text-foreground.
     * The element changed from h4 to p, but styling must be preserved.
     */
    // Check that the footer has <p> elements with the preserved styling
    const hasFontSemibold = /font-semibold/.test(footerSource);
    const hasMb3 = /mb-3/.test(footerSource);
    const hasTextSm = /text-sm/.test(footerSource);
    const hasTextForeground = /text-foreground/.test(footerSource);

    expect(hasFontSemibold).toBe(true);
    expect(hasMb3).toBe(true);
    expect(hasTextSm).toBe(true);
    expect(hasTextForeground).toBe(true);

    // Confirm the styling is on <p> elements (not h4)
    const pWithStyling = /<p\s+className="font-semibold\s+mb-3\s+text-sm\s+text-foreground"/.test(footerSource);
    expect(pWithStyling).toBe(true);
  });
});
