import { test, expect } from "@playwright/experimental-ct-react";
import { SearchInput } from "@/components/admin/SearchInput";

test("renders with placeholder", async ({ mount }) => {
  const component = await mount(
    <SearchInput placeholder="Search products…" value="" onChange={() => {}} />
  );
  await expect(component.getByPlaceholder("Search products…")).toBeVisible();
});

test("typing triggers debounced onChange with final value", async ({ mount }) => {
  let received = "";
  const component = await mount(
    <SearchInput placeholder="Search…" value="" onChange={(v) => { received = v; }} debounceMs={150} />
  );
  await component.getByPlaceholder("Search…").fill("laptop");
  // Wait beyond the debounce window
  await new Promise((r) => setTimeout(r, 300));
  expect(received).toBe("laptop");
});

test("clear button appears when text is present and resets value", async ({ mount }) => {
  let received = "initial";
  const component = await mount(
    <SearchInput placeholder="Search…" value="initial" onChange={(v) => { received = v; }} debounceMs={100} />
  );
  // The clear button (X) should be present
  const clearBtn = component.locator("button");
  await expect(clearBtn).toBeVisible();
  await clearBtn.click();
  expect(received).toBe("");
});

test("shows a search icon", async ({ mount }) => {
  const component = await mount(
    <SearchInput placeholder="Search…" value="" onChange={() => {}} />
  );
  // lucide Search icon renders as an svg
  await expect(component.locator("svg").first()).toBeVisible();
});
