import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      /*
       * Scrolls rather than squeezing.
       *
       * This is `inline-flex` with no overflow rule, so a tab bar wider than
       * the screen had nowhere to go: six settings tabs want 411px and a
       * 360px phone has 328px of it. Call sites were papering over it with
       * `flex-1`, which divides the width instead — 53px per tab, and labels
       * cut in half.
       *
       * Horizontal scroll is what every mobile app does here, and it keeps
       * the labels readable. The scrollbar is hidden because the tabs are
       * obviously swipeable and a bar under them is noise on a control this
       * short.
       */
      "inline-flex h-9 max-w-full items-center justify-start overflow-x-auto rounded-lg bg-muted p-0.5 text-muted-foreground [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // `shrink-0` so a trigger keeps its label rather than being compressed
      "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
