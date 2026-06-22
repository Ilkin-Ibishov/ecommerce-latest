import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ShoppingCart, Check, Loader2 } from "lucide-react";

export interface AnimatedCartButtonProps {
  onAdd: () => Promise<void> | void;
  disabled?: boolean;
  className?: string;
  label?: string;
  size?: "sm" | "md" | "lg";
}

export type ButtonState = "idle" | "loading" | "success" | "error";

const sizeClasses = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-6 text-base",
} as const;

const iconSizes = {
  sm: 14,
  md: 16,
  lg: 18,
} as const;

/**
 * AnimatedCartButton — shared "Add to Cart" button with state-machine animation.
 *
 * State machine:
 *   idle → loading → success → idle (after 1800ms)
 *   idle → loading → error   → idle (after 600ms)
 *
 * - Morph animation via CSS transitions on width/background-color/border-radius
 * - Loading spinner only shown when onAdd is async (returns Promise)
 * - Success: checkmark icon + green-500 background; dispatches `cart-badge-bounce` event
 * - Error: shake animation (3 oscillations, 4px, 400ms)
 * - pointer-events: none during non-idle states
 * - prefers-reduced-motion: skip transitions, show final state immediately
 */
export function AnimatedCartButton({
  onAdd,
  disabled = false,
  className,
  label = "Add to Cart",
  size = "md",
}: AnimatedCartButtonProps) {
  const [state, setState] = useState<ButtonState>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (state !== "idle" || disabled) return;

    const result = onAdd();
    const isAsync = result instanceof Promise;

    if (isAsync) {
      setState("loading");
    }

    try {
      if (isAsync) {
        await result;
      }
      setState("success");

      // Dispatch custom event for cart badge bounce
      window.dispatchEvent(new CustomEvent("cart-badge-bounce"));

      timeoutRef.current = setTimeout(() => {
        setState("idle");
      }, 1800);
    } catch {
      setState("error");
      timeoutRef.current = setTimeout(() => {
        setState("idle");
      }, 600);
    }
  }, [state, disabled, onAdd]);

  const isNonIdle = state !== "idle";
  const skipTransition = reducedMotion.current;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-disabled={isNonIdle || disabled}
      aria-busy={state === "loading"}
      className={cn(
        // Base styles
        "inline-flex items-center justify-center gap-2 rounded-md font-medium",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:opacity-50",
        // Size
        sizeClasses[size],
        // Transitions (respects prefers-reduced-motion)
        !skipTransition &&
          "transition-all duration-300 ease-in-out",
        // State-based styles
        state === "idle" &&
          "bg-primary text-primary-foreground border border-primary-border hover-elevate active-elevate-2",
        state === "loading" &&
          "bg-primary text-primary-foreground border border-primary-border",
        state === "success" &&
          "bg-green-500 text-white border border-green-600",
        state === "error" &&
          "bg-primary text-primary-foreground border border-primary-border animate-cart-shake",
        // Pointer events none during non-idle
        isNonIdle && "pointer-events-none",
        className
      )}
    >
      {state === "loading" && (
        <Loader2 size={iconSizes[size]} className="animate-spin" />
      )}
      {state === "success" && <Check size={iconSizes[size]} />}
      {state === "idle" && <ShoppingCart size={iconSizes[size]} />}
      {state === "error" && <ShoppingCart size={iconSizes[size]} />}

      {/* Show label in idle and error states; hide in loading/success for morph effect */}
      {(state === "idle" || state === "error") && (
        <span>{label}</span>
      )}
      {state === "loading" && (
        <span className="sr-only">Loading</span>
      )}
      {state === "success" && (
        <span className="sr-only">Added</span>
      )}
    </button>
  );
}
