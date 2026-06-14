import { useState } from "react";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";

/**
 * Playwright Component Testing serializes function props across the Node↔browser
 * boundary, which makes it impossible to observe a closure-captured callback
 * (like the one passed to `confirm({ onConfirm })`) directly from the spec.
 *
 * This harness runs entirely inside the browser bundle: it wires `useConfirm`
 * to the real `<ConfirmDialog/>` and records how many times the stored
 * `onConfirm` callback fires in a DOM node the spec can read. The spec only
 * drives the harness through real button clicks and asserts on the DOM,
 * matching the existing harness approach used for DataTable.
 *
 * @see Architecture-refactoring design §12 (Confirmation hook, R12).
 */
export function ConfirmHarness({
  title = "Delete Item",
  message = "Are you sure?",
}: {
  title?: string;
  message?: string;
}) {
  const { confirm, dialogProps } = useConfirm();
  const [runCount, setRunCount] = useState(0);

  return (
    <div>
      <button
        type="button"
        data-testid="trigger"
        onClick={() =>
          confirm({
            title,
            message,
            onConfirm: () => setRunCount((c) => c + 1),
          })
        }
      >
        Open dialog
      </button>
      {/* The spec reads this to verify the stored callback ran exactly once. */}
      <span data-testid="run-count">{runCount}</span>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
