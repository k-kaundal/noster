import { cva } from "class-variance-authority"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /**
         * The primary action is an outline, not a fill.
         *
         * Nocturne's rule, and the reason for it is legible once you look at a
         * screen full of filled buttons: the accent stops meaning "this one"
         * when six things wear it. As a 1px border and a tint on hover it
         * still reads as the primary action and leaves the accent free to mean
         * something where it is used solid — a zap, an active row, a focus
         * ring.
         */
        default:
          "border border-primary bg-primary/[0.06] text-primary hover:bg-primary/15 active:bg-primary/20",
        /** A fill, for the rare place one is genuinely wanted. */
        solid: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)