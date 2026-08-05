import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  /** Hides the wordmark, leaving only the mark. */
  markOnly?: boolean;
}

/**
 * NostrFeed mark: three relay nodes joined by edges, drawn with `currentColor`
 * so it inherits the surrounding text color in both themes.
 */
export function Logo({ className, markOnly = false }: LogoProps) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-sm">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6.5 8.5 12 5.5l5.5 3M6.5 8.5v7l5.5 3 5.5-3v-7" opacity={0.55} />
          <circle cx="12" cy="5.5" r="2" fill="currentColor" stroke="none" />
          <circle cx="6.5" cy="15.5" r="2" fill="currentColor" stroke="none" />
          <circle cx="17.5" cy="15.5" r="2" fill="currentColor" stroke="none" />
        </svg>
      </span>
      {!markOnly && (
        <span className="text-lg font-bold tracking-tight text-brand-gradient">
          NostrFeed
        </span>
      )}
    </span>
  );
}
