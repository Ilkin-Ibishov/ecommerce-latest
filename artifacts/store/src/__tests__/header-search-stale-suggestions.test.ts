// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, fireEvent, waitFor, screen, cleanup, act } from "@testing-library/react";
import { SearchBar } from "@/components/storefront/HeaderSearchBar";

// A suggest request still in flight when the query is shortened below two
// characters must not re-open the dropdown when its response finally lands.

vi.mock("@/lib/i18n/context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HeaderSearchBar suggestions", () => {
  it("drops a response that arrives after the query was shortened to one character", async () => {
    let respond: (body: unknown) => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise((resolve) => {
        respond = (body) => resolve({ json: () => Promise.resolve(body) });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(SearchBar, { locale: "en", onClose: () => {}, inline: true }));
    const input = screen.getByPlaceholderText("Header.searchPlaceholder");

    fireEvent.change(input, { target: { value: "ab" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: "a" } });
    await act(() => new Promise((r) => setTimeout(r, 300))); // past the 250 ms debounce

    await act(async () => {
      respond({ products: [{ id: "p1", slug: "stale", title: "Stale Product", price: 1, image: null }], categories: [] });
    });

    expect(screen.queryByText("Stale Product")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
