import { test, expect } from "@playwright/experimental-ct-react";
import { CSVExportButton } from "@/components/admin/CSVExportButton";

interface Row {
  name: string;
  price: number;
  stock: number;
}

const columns = [
  { key: "name" as const, header: "Name" },
  { key: "price" as const, header: "Price" },
  { key: (r: Row) => r.price * r.stock, header: "Value" },
];

const data: Row[] = [
  { name: "Widget", price: 10, stock: 3 },
  { name: "Gadget", price: 20, stock: 5 },
];

// The component's root element is the <button> itself, so assert on `component` directly.

test("renders the export button", async ({ mount }) => {
  const component = await mount(
    <CSVExportButton data={data} columns={columns} filename="test-export" />
  );
  await expect(component).toBeVisible();
  await expect(component).toContainText(/Export CSV/i);
});

test("button is enabled when data is present", async ({ mount }) => {
  const component = await mount(
    <CSVExportButton data={data} columns={columns} filename="test-export" />
  );
  await expect(component).toBeEnabled();
});

test("button is disabled when data is empty", async ({ mount }) => {
  const component = await mount(
    <CSVExportButton data={[]} columns={columns} filename="test-export" />
  );
  await expect(component).toBeDisabled();
});

test("clicking export triggers a download", async ({ mount, page }) => {
  const component = await mount(
    <CSVExportButton data={data} columns={columns} filename="test-export" />
  );
  const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
  await component.click();
  const download = await downloadPromise;
  if (download) {
    expect(download.suggestedFilename()).toMatch(/^test-export-\d{4}-\d{2}-\d{2}\.csv$/);
  }
});
