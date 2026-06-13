import { test, expect } from "@playwright/experimental-ct-react";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";

/**
 * ConfirmDialog renders via createPortal to document.body, so assertions use
 * `page` (the whole document) rather than `component` (the mounted #root subtree).
 */

const baseProps = {
  open: true,
  title: "Delete Item",
  message: "Are you sure you want to delete this?",
  onConfirm: () => {},
  onCancel: () => {},
};

test("renders title and message when open", async ({ mount, page }) => {
  await mount(<ConfirmDialog {...baseProps} />);
  await expect(page.getByText("Delete Item")).toBeVisible();
  await expect(page.getByText("Are you sure you want to delete this?")).toBeVisible();
});

test("does not render when open is false", async ({ mount, page }) => {
  await mount(<ConfirmDialog {...baseProps} open={false} />);
  await expect(page.getByText("Delete Item")).toHaveCount(0);
});

test("invokes onConfirm when confirm button clicked", async ({ mount, page }) => {
  let confirmed = false;
  await mount(
    <ConfirmDialog {...baseProps} confirmLabel="Delete" onConfirm={() => { confirmed = true; }} />
  );
  await page.getByRole("button", { name: "Delete" }).click();
  expect(confirmed).toBe(true);
});

test("invokes onCancel when cancel button clicked", async ({ mount, page }) => {
  let cancelled = false;
  await mount(
    <ConfirmDialog {...baseProps} cancelLabel="Cancel" onCancel={() => { cancelled = true; }} />
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(cancelled).toBe(true);
});

test("destructive mode applies red styling to confirm button", async ({ mount, page }) => {
  await mount(<ConfirmDialog {...baseProps} confirmLabel="Delete" destructive />);
  const confirmBtn = page.getByRole("button", { name: "Delete" });
  await expect(confirmBtn).toHaveClass(/bg-red-500/);
});

test("uses custom confirm and cancel labels", async ({ mount, page }) => {
  await mount(
    <ConfirmDialog {...baseProps} confirmLabel="Yes, proceed" cancelLabel="No, go back" />
  );
  await expect(page.getByRole("button", { name: "Yes, proceed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "No, go back" })).toBeVisible();
});
