import { describe, it, expect } from "vitest";
import sanitizeHtmlLib from "sanitize-html";

/**
 * Tests for HTML sanitization in page translations endpoint (Task 4.3).
 * Validates Requirement 7.3: Only safe elements/attributes are preserved.
 */

const SANITIZE_CONFIG: sanitizeHtmlLib.IOptions = {
  allowedTags: ["p", "h2", "h3", "h4", "strong", "em", "ul", "ol", "li", "a", "img", "br", "blockquote"],
  allowedAttributes: {
    a: ["href"],
    img: ["src", "alt"],
  },
  disallowedTagsMode: "discard",
};

function sanitize(html: string): string {
  return sanitizeHtmlLib(html, SANITIZE_CONFIG);
}

describe("HTML sanitization for page translations", () => {
  describe("allowed elements are preserved", () => {
    it("preserves p, h2, h3, h4 elements", () => {
      const input = "<p>Hello</p><h2>Title</h2><h3>Subtitle</h3><h4>Section</h4>";
      expect(sanitize(input)).toBe(input);
    });

    it("preserves strong and em elements", () => {
      const input = "<p><strong>Bold</strong> and <em>italic</em></p>";
      expect(sanitize(input)).toBe(input);
    });

    it("preserves list elements (ul, ol, li)", () => {
      const input = "<ul><li>Item 1</li><li>Item 2</li></ul><ol><li>First</li></ol>";
      expect(sanitize(input)).toBe(input);
    });

    it("preserves anchor tags with href attribute", () => {
      const input = '<p><a href="https://example.com">Link</a></p>';
      expect(sanitize(input)).toBe(input);
    });

    it("preserves img tags with src and alt attributes", () => {
      const input = '<img src="https://example.com/img.png" alt="Description">';
      expect(sanitize(input)).toContain('src="https://example.com/img.png"');
      expect(sanitize(input)).toContain('alt="Description"');
    });

    it("preserves br elements", () => {
      const input = "<p>Line 1<br>Line 2</p>";
      const result = sanitize(input);
      // sanitize-html outputs self-closing <br /> which is valid XHTML
      expect(result).toMatch(/<br\s*\/?>/);
    });

    it("preserves blockquote elements", () => {
      const input = "<blockquote><p>A quote</p></blockquote>";
      expect(sanitize(input)).toBe(input);
    });
  });

  describe("dangerous elements are stripped", () => {
    it("removes script tags", () => {
      const input = '<p>Hello</p><script>alert("xss")</script>';
      const result = sanitize(input);
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
      expect(result).toContain("<p>Hello</p>");
    });

    it("removes iframe tags", () => {
      const input = '<p>Content</p><iframe src="https://evil.com"></iframe>';
      const result = sanitize(input);
      expect(result).not.toContain("<iframe");
      expect(result).toContain("<p>Content</p>");
    });

    it("removes event handler attributes", () => {
      const input = '<p onclick="alert(1)">Click me</p>';
      const result = sanitize(input);
      expect(result).not.toContain("onclick");
      expect(result).toContain("<p>Click me</p>");
    });

    it("removes onerror attributes from img tags", () => {
      const input = '<img src="x" onerror="alert(1)" alt="test">';
      const result = sanitize(input);
      expect(result).not.toContain("onerror");
      expect(result).toContain('alt="test"');
    });

    it("removes style attributes", () => {
      const input = '<p style="color: red">Styled</p>';
      const result = sanitize(input);
      expect(result).not.toContain("style");
      expect(result).toContain("<p>Styled</p>");
    });

    it("removes class attributes", () => {
      const input = '<p class="danger">Text</p>';
      const result = sanitize(input);
      expect(result).not.toContain("class");
      expect(result).toContain("<p>Text</p>");
    });

    it("removes div elements (not in allowed list)", () => {
      const input = "<div><p>Inside div</p></div>";
      const result = sanitize(input);
      expect(result).not.toContain("<div");
      expect(result).toContain("<p>Inside div</p>");
    });

    it("removes span elements (not in allowed list)", () => {
      const input = "<p><span>Text</span></p>";
      const result = sanitize(input);
      expect(result).not.toContain("<span");
      expect(result).toContain("<p>Text</p>");
    });

    it("removes form and input elements", () => {
      const input = '<form action="/steal"><input type="text" name="cc"></form>';
      const result = sanitize(input);
      expect(result).not.toContain("<form");
      expect(result).not.toContain("<input");
    });

    it("removes javascript: protocol from href", () => {
      const input = '<a href="javascript:alert(1)">Click</a>';
      const result = sanitize(input);
      expect(result).not.toContain("javascript:");
    });
  });

  describe("disallowed attributes on allowed elements", () => {
    it("removes target attribute from anchor tags", () => {
      const input = '<a href="https://example.com" target="_blank">Link</a>';
      const result = sanitize(input);
      expect(result).not.toContain("target");
      expect(result).toContain('href="https://example.com"');
    });

    it("removes id attributes", () => {
      const input = '<h2 id="section-1">Title</h2>';
      const result = sanitize(input);
      expect(result).not.toContain("id=");
      expect(result).toContain("<h2>Title</h2>");
    });

    it("removes data-* attributes", () => {
      const input = '<p data-custom="value">Text</p>';
      const result = sanitize(input);
      expect(result).not.toContain("data-");
      expect(result).toContain("<p>Text</p>");
    });
  });

  describe("edge cases", () => {
    it("handles empty string input", () => {
      expect(sanitize("")).toBe("");
    });

    it("handles plain text without HTML", () => {
      const input = "Just plain text";
      expect(sanitize(input)).toBe("Just plain text");
    });

    it("handles nested allowed elements", () => {
      const input = "<ul><li><strong>Bold item</strong></li><li><em>Italic item</em></li></ul>";
      expect(sanitize(input)).toBe(input);
    });

    it("strips deeply nested script tags", () => {
      const input = '<p><strong><em><a href="x"><script>alert(1)</script>safe</a></em></strong></p>';
      const result = sanitize(input);
      expect(result).not.toContain("<script");
      expect(result).toContain("safe");
    });
  });
});
