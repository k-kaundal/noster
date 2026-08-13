import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Whether this is a phone-width screen.
 *
 * Measured on the first render rather than after it. It used to report `false`
 * until an effect ran, so every layout that branches on it painted the desktop
 * shape for a frame and then swapped — which for a screen that changes
 * structure, like a chat thread going full-screen, is a visible flash and a
 * remount of everything inside it.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(
    () =>
      typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
