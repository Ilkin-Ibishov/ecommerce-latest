import type { ReactNode } from "react";

export interface TableEmptyStateProps {
  message: ReactNode;
  colSpan: number;
}

/**
 * A single full-width table row used to render an empty / no-results state.
 * Markup + classes mirror the inline empty rows used across the admin list
 * pages (OrdersPage, UsersPage) so migrated pages render identically.
 */
export function TableEmptyState({ message, colSpan }: TableEmptyStateProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-muted-foreground">
        {message}
      </td>
    </tr>
  );
}
