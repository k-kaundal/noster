import * as React from "react"
import * as HoverCardPrimitive from "@radix-ui/react-hover-card"

import { cn } from "@/lib/utils"

const HoverCard = HoverCardPrimitive.Root

const HoverCardTrigger = HoverCardPrimitive.Trigger

/**
 * Portalled, which is not optional here.
 *
 * Radix positions this with `position: fixed` and coordinates measured
 * against the viewport. Rendered inline, it lands inside whatever card the
 * trigger lives in — and feed cards carry `content-visibility: auto`, which
 * implies `contain: paint` and so becomes the containing block for fixed
 * descendants. The viewport coordinates then get re-based by the card's own
 * offset, putting the preview hundreds of pixels down and to the right of the
 * name it belongs to, clipped at the edge of the screen.
 *
 * Moving it to `document.body` puts it back in the viewport's coordinate
 * space, which is the one the numbers were computed in. Every other popper in
 * this directory already does this.
 */
const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
  <HoverCardPrimitive.Portal>
    <HoverCardPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // Never flush against the edge of the window, where a card reads as
      // cut off even when all of it is on screen
      collisionPadding={collisionPadding}
      className={cn(
        "z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </HoverCardPrimitive.Portal>
))
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName

export { HoverCard, HoverCardTrigger, HoverCardContent }
