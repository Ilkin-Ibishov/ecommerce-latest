import { test, expect } from "@playwright/experimental-ct-react";
import { SortableHeader } from "@/components/admin/SortableHeader";

/**
 * SortableHeader renders a <th>, so it must be mounted inside a table structure
 * to be valid DOM.
 */
function wrap(node: React.ReactNode) {
  return (
    <table>
      <thead>
        <tr>{node}</tr>
      </thead>
    </table>
  );
}

test("renders the column label", async ({ mount }) => {
  const component = await mount(
    wrap(
      <SortableHeader label="Price" sortKey="price" currentSort={null} currentDir="asc" onSort={() => {}} />
    )
  );
  await expect(component.getByText("Price")).toBeVisible();
});

test("clicking calls onSort with ascending when not active", async ({ mount }) => {
  let captured: { key: string; dir: string } | null = null;
  const component = await mount(
    wrap(
      <SortableHeader
        label="Price"
        sortKey="price"
        currentSort={null}
        currentDir="asc"
        onSort={(key, dir) => { captured = { key, dir }; }}
      />
    )
  );
  await component.getByText("Price").click();
  expect(captured).toEqual({ key: "price", dir: "asc" });
});

test("clicking an active asc column toggles to desc", async ({ mount }) => {
  let captured: { key: string; dir: string } | null = null;
  const component = await mount(
    wrap(
      <SortableHeader
        label="Price"
        sortKey="price"
        currentSort="price"
        currentDir="asc"
        onSort={(key, dir) => { captured = { key, dir }; }}
      />
    )
  );
  await component.getByText("Price").click();
  expect(captured).toEqual({ key: "price", dir: "desc" });
});

test("clicking an active desc column toggles back to asc", async ({ mount }) => {
  let captured: { key: string; dir: string } | null = null;
  const component = await mount(
    wrap(
      <SortableHeader
        label="Price"
        sortKey="price"
        currentSort="price"
        currentDir="desc"
        onSort={(key, dir) => { captured = { key, dir }; }}
      />
    )
  );
  await component.getByText("Price").click();
  expect(captured).toEqual({ key: "price", dir: "asc" });
});
