import * as React from "react"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

const TOAST_LIMIT = 3
const DEFAULT_TOAST_DURATION = 3000

/**
 * Clamp a duration value to the valid range [1000, 10000] ms.
 * Exported as a pure function for testability.
 */
export function clampDuration(value: number): number {
  return Math.max(1000, Math.min(10000, value))
}

type ToastVariant = "default" | "destructive" | "success"

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
  variant?: ToastVariant
  duration?: number
}

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType["ADD_TOAST"]
      toast: ToasterToast
    }
  | {
      type: ActionType["UPDATE_TOAST"]
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType["DISMISS_TOAST"]
      toastId?: ToasterToast["id"]
    }
  | {
      type: ActionType["REMOVE_TOAST"]
      toastId?: ToasterToast["id"]
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string, duration?: number) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const delay = clampDuration(duration ?? DEFAULT_TOAST_DURATION)

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    })
  }, delay)

  toastTimeouts.set(toastId, timeout)
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST": {
      const newToasts = [action.toast, ...state.toasts]

      // When 4th toast arrives, dismiss the oldest (last in array since newest is first)
      if (newToasts.length > TOAST_LIMIT) {
        const oldest = newToasts[newToasts.length - 1]
        // Immediately dismiss the oldest toast
        if (oldest) {
          // Clear any existing timeout for this toast
          const existingTimeout = toastTimeouts.get(oldest.id)
          if (existingTimeout) {
            clearTimeout(existingTimeout)
            toastTimeouts.delete(oldest.id)
          }
          // Schedule immediate removal
          setTimeout(() => {
            dispatch({ type: "REMOVE_TOAST", toastId: oldest.id })
          }, 0)
        }
        return {
          ...state,
          toasts: newToasts.slice(0, TOAST_LIMIT),
        }
      }

      return {
        ...state,
        toasts: newToasts,
      }
    }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

      if (toastId) {
        // Find the toast to get its duration for the remove delay
        const toastItem = state.toasts.find((t) => t.id === toastId)
        addToRemoveQueue(toastId, toastItem?.duration)
      } else {
        state.toasts.forEach((t) => {
          addToRemoveQueue(t.id, t.duration)
        })
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      }
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, "id">

function toast({ ...props }: Toast) {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss()
      },
    },
  })

  // Schedule auto-dismiss based on per-toast duration
  const duration = clampDuration(props.duration ?? DEFAULT_TOAST_DURATION)
  setTimeout(() => {
    dismiss()
  }, duration)

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  }
}

/** Toast helper: item added to cart */
export function toastCartAdd(t: (key: string) => string, productName: string) {
  toast({
    description: t("Toast.cartAdd").replace("{name}", productName),
    variant: "success",
  })
}

/** Toast helper: item saved to wishlist */
export function toastWishlist(t: (key: string) => string, _productName: string) {
  toast({
    description: t("Toast.wishlistAdd"),
    variant: "default",
  })
}

/** Toast helper: coupon applied */
export function toastCouponApplied(t: (key: string) => string, _description: string) {
  toast({
    description: t("Toast.couponApplied"),
    variant: "success",
  })
}

/** Toast helper: out of stock warning */
export function toastOutOfStock(t: (key: string) => string, _productName: string) {
  toast({
    description: t("Toast.outOfStock"),
    variant: "destructive",
  })
}

export { useToast, toast }
export type { ToasterToast, Toast, ToastVariant }
export { TOAST_LIMIT, DEFAULT_TOAST_DURATION }
