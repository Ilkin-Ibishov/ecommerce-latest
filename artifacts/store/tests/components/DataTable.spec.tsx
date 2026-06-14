import { test, expect } from "@playwright/experimental-ct-react";
import { DataTableHarness, type HarnessRow } from "./harness/TableHarness";

// NOTE: DataTable takes synchronous render functions (column.cell / getRowKey).
// Playwright CT can't serialize those across the Node↔browser boundary, so the
// columns/getRowKey are built inside DataTableHarness (browser bundle) and the
// spec only passes plain, serializable data.

const rows: HarnessRow[] = [
  { id: "1", name: "Widget", price: 10 },
  { id: "2", name: "Gadget", price: 20 },
];

test("renders the column headers", async ({ mount }) => {
  const component = await mount(<DataTableHarness rows={rows} loading={false} />);
  await expect(component.getByText("Name")).toBeVisible();
  await expect(component.getByText("Price")).toBeVisible();
});

test("renders a data row per row using column.cell", async ({ mount }) => {
  const component = await mount(<DataTableHarness rows={rows} loading={false} />);
  // Two data rows are rendered in the tbody
  await expect(component.locator("tbody tr")).toHaveCount(2);
  // Cells rendered via column.cell
  const tbody = component.locator("tbody");
  await expect(tbody).toContainText("Widget");
  await expect(tbody).toContainText("$10");
  await expect(tbody).toContainText("Gadget");
  await expect(tbody).toContainText("$20");
});

test("renders the empty node and no data rows when not loading and rows is empty", async ({ mount }) => {
  const component = await mount(<DataTableHarness rows={[]} loading={false} />);
  // The empty node is rendered
  await expect(component.getByText("No results")).toBeVisible();
  // Exactly one tbody row (the empty-state row), no data rows
  await expect(component.locator("tbody tr")).toHaveCount(1);
  await expect(component.getByText("Widget")).toHaveCount(0);
});

test("does not render the empty node while loading even when rows is empty", async ({ mount }) => {
  const component = await mount(<DataTableHarness rows={[]} loading={true} />);
  await expect(component.getByText("No results")).toHaveCount(0);
  await expect(component.locator("tbody tr")).toHaveCount(0);
});
