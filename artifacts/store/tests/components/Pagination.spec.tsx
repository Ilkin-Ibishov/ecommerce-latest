import { test, expect } from "@playwright/experimental-ct-react";
import { PaginationHarness } from "./harness/TableHarness";

// NOTE: Pagination takes a synchronous `buildHref` render function. Playwright CT
// can't serialize that across the Node↔browser boundary, so buildHref is built
// inside PaginationHarness (browser bundle); the spec passes only plain props.
// hrefBase defaults to "/admin/orders/", producing hrefs like "/admin/orders/3".

test("renders nothing when there is a single page or fewer", async ({ mount }) => {
  const component = await mount(<PaginationHarness page={1} totalPages={1} />);
  await expect(component.locator("nav")).toHaveCount(0);
});

test("renders Prev/Next and numbered links when there is more than one page", async ({ mount }) => {
  const component = await mount(<PaginationHarness page={2} totalPages={3} />);
  // Prev + Next present (page 2 of 3)
  await expect(component.getByRole("link", { name: "Previous page" })).toBeVisible();
  await expect(component.getByRole("link", { name: "Next page" })).toBeVisible();
  // Numbered page links 1..3
  await expect(component.getByRole("link", { name: "Page 1" })).toBeVisible();
  await expect(component.getByRole("link", { name: "Page 2" })).toBeVisible();
  await expect(component.getByRole("link", { name: "Page 3" })).toBeVisible();
});

test("does not render Prev on the first page and Next on the last page", async ({ mount }) => {
  const first = await mount(<PaginationHarness page={1} totalPages={3} />);
  await expect(first.getByRole("link", { name: "Previous page" })).toHaveCount(0);
  await expect(first.getByRole("link", { name: "Next page" })).toBeVisible();
});

test("marks the active page with aria-current=page", async ({ mount }) => {
  const component = await mount(<PaginationHarness page={2} totalPages={3} />);
  const active = component.getByRole("link", { name: "Page 2" });
  await expect(active).toHaveAttribute("aria-current", "page");
  // Non-active page link has no aria-current
  await expect(component.getByRole("link", { name: "Page 1" })).not.toHaveAttribute("aria-current", "page");
});

test("hrefs are produced by buildHref", async ({ mount }) => {
  const component = await mount(<PaginationHarness page={2} totalPages={3} />);
  await expect(component.getByRole("link", { name: "Page 3" })).toHaveAttribute("href", "/admin/orders/3");
  await expect(component.getByRole("link", { name: "Previous page" })).toHaveAttribute("href", "/admin/orders/1");
  await expect(component.getByRole("link", { name: "Next page" })).toHaveAttribute("href", "/admin/orders/3");
});
