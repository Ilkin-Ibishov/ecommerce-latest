import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

import { Spinner } from "./spinner"

interface ShimmerProps {
  className?: string
  children?: React.ReactNode
}

/**
 * Wraps children in a container with the `.shimmer` CSS animation.
 * When the user prefers reduced motion, renders a static Spinner instead.
 */
function Shimmer({ className, children }: ShimmerProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setPrefersReducedMotion(mq.matches)

    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  if (prefersReducedMotion) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <Spinner className="size-5" />
      </div>
    )
  }

  return (
    <div className={cn("shimmer", className)}>
      {children}
    </div>
  )
}

export { Shimmer }
export type { ShimmerProps }
