import { useState } from "react";
import { SortDropdown, type SortOption } from "@/components/storefront/SortDropdown";
import { I18nProvider } from "@/lib/i18n/context";

/**
 * Playwright Component Testing passes function props (onChange) across the
 * Node↔browser boundary as fire-and-forget async callbacks, so a spec can't read
 * the argument back directly. This harness runs entirely in the browser bundle:
 * it owns the SortDropdown's `value` state, updates it from `onChange`, and
 * reflects the selected SortOption into the DOM (`[data-testid="selected"]`) so
 * the spec can assert exactly which value `onChange` was invoked with.
 *
 * SortDropdown calls useI18n() t(), so it's wrapped in I18nProvider.
 */
export function SortDropdownHarness({ initial = "newest" }: { initial?: SortOption }) {
  const [value, setValue] = useState<SortOption>(initial);
  return (
    <I18nProvider locale="az">
      <div>
        <span data-testid="selected">{value}</span>
        <SortDropdown value={value} onChange={setValue} />
      </div>
    </I18nProvider>
  );
}
