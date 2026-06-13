import { describe, it, expect } from "vitest";

/**
 * Unit tests for ImageCandidateGrid selection logic.
 *
 * Since the vitest environment is "node" (no jsdom), these tests
 * validate the pure selection logic extracted from the component behavior.
 *
 * Validates: Requirements 3.2, 3.3, 4.2, 7.4
 */

// Extract the selection logic that the component uses
function computeSelectionChange(
  url: string,
  selectedUrls: string[],
  existingUrls: string[],
  remainingSlots: number
): string[] | null {
  // Already added to product — not clickable
  if (existingUrls.includes(url)) return null;

  const isSelected = selectedUrls.includes(url);
  const selectionLimitReached = selectedUrls.length >= remainingSlots;

  if (isSelected) {
    // Deselect
    return selectedUrls.filter((u) => u !== url);
  } else {
    // Can only select if we haven't reached the limit
    if (!selectionLimitReached) {
      return [...selectedUrls, url];
    }
  }
  return null; // No change
}

describe("ImageCandidateGrid selection logic", () => {
  const candidates = [
    "https://example.com/img1.jpg",
    "https://example.com/img2.jpg",
    "https://example.com/img3.jpg",
    "https://example.com/img4.jpg",
  ];

  describe("multi-select behavior", () => {
    it("selects an unselected candidate", () => {
      const result = computeSelectionChange(candidates[0], [], [], 3);
      expect(result).toEqual([candidates[0]]);
    });

    it("deselects a selected candidate", () => {
      const result = computeSelectionChange(
        candidates[0],
        [candidates[0], candidates[1]],
        [],
        3
      );
      expect(result).toEqual([candidates[1]]);
    });

    it("allows selecting multiple candidates", () => {
      const selected = [candidates[0]];
      const result = computeSelectionChange(candidates[1], selected, [], 3);
      expect(result).toEqual([candidates[0], candidates[1]]);
    });
  });

  describe("remaining slot limit enforcement", () => {
    it("prevents selection when limit is reached", () => {
      // 2 remaining slots, already 2 selected → can't add more
      const result = computeSelectionChange(
        candidates[2],
        [candidates[0], candidates[1]],
        [],
        2
      );
      expect(result).toBeNull();
    });

    it("allows deselection even when limit is reached", () => {
      // 2 remaining slots, 2 selected → can still deselect
      const result = computeSelectionChange(
        candidates[0],
        [candidates[0], candidates[1]],
        [],
        2
      );
      expect(result).toEqual([candidates[1]]);
    });

    it("allows selection when under the limit", () => {
      const result = computeSelectionChange(
        candidates[1],
        [candidates[0]],
        [],
        3
      );
      expect(result).toEqual([candidates[0], candidates[1]]);
    });

    it("prevents selection when remainingSlots is 0", () => {
      const result = computeSelectionChange(candidates[0], [], [], 0);
      expect(result).toBeNull();
    });
  });

  describe("existing URLs (already added to product)", () => {
    it("returns null for URLs already on the product", () => {
      const result = computeSelectionChange(
        candidates[0],
        [],
        [candidates[0]],
        3
      );
      expect(result).toBeNull();
    });

    it("allows selection of non-existing URLs while existing URLs are present", () => {
      const result = computeSelectionChange(
        candidates[1],
        [],
        [candidates[0]],
        3
      );
      expect(result).toEqual([candidates[1]]);
    });
  });
});
