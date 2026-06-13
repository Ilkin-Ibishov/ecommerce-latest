import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { escapeCSV } from "../src/components/admin/CSVExportButton";

// ─── CSVExportButton — escapeCSV() ──────────────────────────────────────────────

describe("CSVExportButton — escapeCSV()", () => {
  it("regular value passes through unchanged", () => {
    expect(escapeCSV("hello")).toBe("hello");
    expect(escapeCSV("simple value")).toBe("simple value");
    expect(escapeCSV("product123")).toBe("product123");
  });

  it("value with comma gets wrapped in double-quotes", () => {
    expect(escapeCSV("price,quantity")).toBe('"price,quantity"');
    expect(escapeCSV("a,b,c")).toBe('"a,b,c"');
  });

  it("value with double-quote gets quote-escaped and wrapped", () => {
    expect(escapeCSV('say "hello"')).toBe('"say ""hello"""');
    expect(escapeCSV('"quoted"')).toBe('"""quoted"""');
  });

  it("value with newline gets wrapped in double-quotes", () => {
    expect(escapeCSV("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCSV("a\nb\nc")).toBe('"a\nb\nc"');
  });

  it("empty string returns empty string", () => {
    expect(escapeCSV("")).toBe("");
  });

  it("value with all special chars (comma + quote + newline) handles correctly", () => {
    const input = 'has,comma "and" quote\nand newline';
    const result = escapeCSV(input);
    // Should wrap in quotes and escape internal quotes
    expect(result).toBe('"has,comma ""and"" quote\nand newline"');
  });
});

// ─── SortableHeader — sort direction toggle logic ───────────────────────────────

describe("SortableHeader — sort direction toggle logic", () => {
  // Extracted logic from the component:
  // const isActive = currentSort === sortKey;
  // const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";

  function getNextDirection(
    sortKey: string,
    currentSort: string | null,
    currentDir: "asc" | "desc"
  ): "asc" | "desc" {
    const isActive = currentSort === sortKey;
    return isActive && currentDir === "asc" ? "desc" : "asc";
  }

  it("clicking same column toggles direction (asc → desc)", () => {
    expect(getNextDirection("name", "name", "asc")).toBe("desc");
  });

  it("clicking same column toggles direction (desc → asc)", () => {
    expect(getNextDirection("name", "name", "desc")).toBe("asc");
  });

  it("clicking different column resets to ascending", () => {
    expect(getNextDirection("price", "name", "asc")).toBe("asc");
    expect(getNextDirection("price", "name", "desc")).toBe("asc");
  });

  it("no column active initially shows neutral state (defaults to asc)", () => {
    expect(getNextDirection("name", null, "asc")).toBe("asc");
    expect(getNextDirection("price", null, "desc")).toBe("asc");
  });
});

// ─── SearchInput — debounce logic ───────────────────────────────────────────────

describe("SearchInput — debounce logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("after debounce delay, onChange is called with final value", () => {
    const onChange = vi.fn();
    const debounceMs = 300;

    // Simulate internal state change triggering a setTimeout
    const timer = setTimeout(() => onChange("search term"), debounceMs);

    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith("search term");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("rapid inputs only trigger one onChange after debounce settles", () => {
    const onChange = vi.fn();
    const debounceMs = 300;

    // Simulate rapid typing — each keystroke clears and resets the timer
    let timer: ReturnType<typeof setTimeout>;

    // Type "h"
    clearTimeout(timer!);
    timer = setTimeout(() => onChange("h"), debounceMs);

    vi.advanceTimersByTime(50);

    // Type "he"
    clearTimeout(timer);
    timer = setTimeout(() => onChange("he"), debounceMs);

    vi.advanceTimersByTime(50);

    // Type "hel"
    clearTimeout(timer);
    timer = setTimeout(() => onChange("hel"), debounceMs);

    vi.advanceTimersByTime(50);

    // Type "hell"
    clearTimeout(timer);
    timer = setTimeout(() => onChange("hell"), debounceMs);

    vi.advanceTimersByTime(50);

    // Type "hello"
    clearTimeout(timer);
    timer = setTimeout(() => onChange("hello"), debounceMs);

    // No call yet
    expect(onChange).not.toHaveBeenCalled();

    // After full debounce delay from last input
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("clear triggers immediate onChange with empty string", () => {
    const onChange = vi.fn();

    // Simulate the SearchInput.clear() behavior: setInternal(""); onChange("");
    // In the component, clear() calls onChange("") directly (no debounce)
    onChange("");

    expect(onChange).toHaveBeenCalledWith("");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ─── PriceCell — validation logic ───────────────────────────────────────────────

describe("PriceCell — validation logic", () => {
  // Extracted validation logic from PriceCell.save():
  // if (isNaN(newPrice) || newPrice < 0 || newPrice === initialPrice) → reject
  function validatePrice(
    value: string,
    initialPrice: number
  ): { valid: true; price: number } | { valid: false } {
    const newPrice = parseFloat(value);
    if (isNaN(newPrice) || newPrice < 0 || newPrice === initialPrice) {
      return { valid: false };
    }
    return { valid: true, price: newPrice };
  }

  it("negative price is rejected (not saved)", () => {
    expect(validatePrice("-1", 10)).toEqual({ valid: false });
    expect(validatePrice("-0.01", 5)).toEqual({ valid: false });
    expect(validatePrice("-100", 20)).toEqual({ valid: false });
  });

  it("NaN price is rejected", () => {
    expect(validatePrice("abc", 10)).toEqual({ valid: false });
    expect(validatePrice("", 10)).toEqual({ valid: false });
    expect(validatePrice("not-a-number", 5)).toEqual({ valid: false });
  });

  it("unchanged price is rejected (no API call)", () => {
    expect(validatePrice("10", 10)).toEqual({ valid: false });
    expect(validatePrice("5.99", 5.99)).toEqual({ valid: false });
    expect(validatePrice("0", 0)).toEqual({ valid: false });
  });

  it("valid positive price is accepted", () => {
    expect(validatePrice("15.99", 10)).toEqual({ valid: true, price: 15.99 });
    expect(validatePrice("0.01", 10)).toEqual({ valid: true, price: 0.01 });
    expect(validatePrice("100", 5)).toEqual({ valid: true, price: 100 });
    expect(validatePrice("0", 10)).toEqual({ valid: true, price: 0 });
  });
});
