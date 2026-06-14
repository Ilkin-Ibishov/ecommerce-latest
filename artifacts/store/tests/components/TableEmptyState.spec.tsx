import { test, expect } from "@playwright/experimental-ct-react";
import { TableEmptyState } from "@/components/admin/TableEmptyState";

/**
 * TableEmptyState renders a <tr>, so it must be mounted inside a table
 * structure to be valid DOM.
 */
function wrap(node: React.ReactNode) {
  return (
    <table>
      <tbody>{node}</tbody>
    </table>
  );
}

test("renders the message", async ({ mount }) => {
  const component = await mount(wrap(<TableEmptyState message="No results found" colSpan={4} />));
  await expect(component.getByText("No results found")).toBeVisible();
});

test("renders a single row with one cell spanning colSpan", async ({ mount }) => {
  const component = await mount(wrap(<TableEmptyState message="No results found" colSpan={4} />));
  await expect(component.locator("tr")).toHaveCount(1);
  const cell = component.locator("td");
  await expect(cell).toHaveCount(1);
  await expect(cell).toHaveAttribute("colspan", "4");
});
