export const HAPPY_PATH_STEPS = [
  { key: "pending", labelKey: "OrderTracking.stepPending" },
  { key: "phone_verified", labelKey: "OrderTracking.stepVerified" },
  { key: "courier_assigned", labelKey: "OrderTracking.stepCourierAssigned" },
  { key: "shipped", labelKey: "OrderTracking.stepShipped" },
  { key: "delivered", labelKey: "OrderTracking.stepDelivered" },
] as const;

export const STEP_INDEX: Record<string, number> = {
  pending: 0,
  phone_verified: 1,
  courier_assigned: 2,
  shipped: 3,
  delivered: 4,
};

export type StepState = "completed" | "active" | "future" | "success" | "failure";

export interface StatusHistoryEntry {
  old_status: string | null;
  new_status: string;
  changed_at: string;
}

/**
 * Derives the visual state for each step in the order tracking timeline.
 *
 * - "delivered" → all steps become "success"
 * - "cancelled" / "refused_at_delivery" → steps that appear in history are "completed", rest are "future"
 *   (the component renders a separate failure badge at the terminal point)
 * - Normal progression → steps before current are "completed", current is "active", rest are "future"
 */
export function deriveStepStates(
  status: string,
  history: StatusHistoryEntry[],
): StepState[] {
  // If delivered, all steps are success
  if (status === "delivered") return Array(5).fill("success") as StepState[];

  // If terminal failure, derive from history which steps were completed
  if (status === "cancelled" || status === "refused_at_delivery") {
    const completedStatuses = new Set(history.map((h) => h.new_status));
    return HAPPY_PATH_STEPS.map((step) => {
      if (completedStatuses.has(step.key) && (step.key as string) !== status)
        return "completed";
      return "future";
    });
    // Component renders a separate failure badge at the terminal point
  }

  // Normal progression
  const currentIdx = STEP_INDEX[status] ?? 0;
  return HAPPY_PATH_STEPS.map((_, i) => {
    if (i < currentIdx) return "completed";
    if (i === currentIdx) return "active";
    return "future";
  });
}
