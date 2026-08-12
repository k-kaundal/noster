import { useEffect } from "react"
import { useToast } from "@/hooks/useToast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts, dismiss } = useToast()

  const hasOpen = toasts.some((toast) => toast.open)

  /**
   * Dismisses on a tap anywhere else.
   *
   * Radix toasts are deliberately non-modal and do not close on an outside
   * click — reasonable for a desktop corner toast, wrong for a phone, where
   * the toast sits across the top of the screen in the middle of everything
   * and reads as something blocking the way. Reaching past it to carry on now
   * clears it, which is what people try first.
   *
   * `pointerdown` rather than `click`, so it goes at the start of the tap and
   * whatever was underneath still receives its own event.
   */
  useEffect(() => {
    if (!hasOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null

      // Inside the toast, so it is the close button or an action, not "away"
      if (target?.closest?.("[data-toast-viewport]")) return

      dismiss()
    }

    /**
     * Capture, and on the next frame. Without the delay the very click that
     * produced the toast dismisses it again before it has been seen.
     */
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true)
    }, 0)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("pointerdown", onPointerDown, true)
    }
  }, [hasOpen, dismiss])

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
