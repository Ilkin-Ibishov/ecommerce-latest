import { test, expect } from "@playwright/experimental-ct-react";
import { ConfirmHarness } from "./harness/ConfirmHarness";

/**
 * useConfirm() drives the existing <ConfirmDialog/>, which renders via
 * createPortal to document.body. So dialog assertions use `page` (whole
 * document) while the run-count probe lives in the mounted harness subtree.
 *
 * Validates: Requirements 12.5 — Architecture-refactoring design §12.
 */

test("confirm() opens the dialog with the given title and message", async ({ mount, page }) => {
  const component = await mount(
    <ConfirmHarness title="Delete Product" message="This cannot be undone." />
  );

  // Dialog is closed initially (open=false): copy not in the document.
  await expect(page.getByText("Delete Product")).toHaveCount(0);

  await component.getByTestId("trigger").click();

  // confirm({...}) set dialogProps.open=true with the supplied copy.
  await expect(page.getByText("Delete Product")).toBeVisible();
  await expect(page.getByText("This cannot be undone.")).toBeVisible();
});

test("dialogProps.onConfirm runs the stored callback exactly once and closes", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <ConfirmHarness title="Delete Product" message="This cannot be undone." />
  );

  await expect(component.getByTestId("run-count")).toHaveText("0");

  await component.getByTestId("trigger").click();
  await expect(page.getByText("Delete Product")).toBeVisible();

  // ConfirmDialog's confirm button defaults to the "Confirm" label.
  await page.getByRole("button", { name: "Confirm", exact: true }).click();

  // Stored onConfirm ran exactly once...
  await expect(component.getByTestId("run-count")).toHaveText("1");
  // ...and the dialog closed (open=false).
  await expect(page.getByText("Delete Product")).toHaveCount(0);
});

test("dialogProps.onCancel closes the dialog WITHOUT running the callback", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <ConfirmHarness title="Delete Product" message="This cannot be undone." />
  );

  await component.getByTestId("trigger").click();
  await expect(page.getByText("Delete Product")).toBeVisible();

  // ConfirmDialog's cancel button defaults to the "Cancel" label.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // Dialog closed...
  await expect(page.getByText("Delete Product")).toHaveCount(0);
  // ...and the stored onConfirm never ran.
  await expect(component.getByTestId("run-count")).toHaveText("0");
});
