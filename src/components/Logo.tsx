import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  /** Hides the wordmark, leaving only the mark. */
  markOnly?: boolean;
}

/**
 * The NostrFeed mark: a capital N built from relay nodes and the edges between
 * them. The letterform survives at favicon size while the nodes read as a
 * network once there is room for them.
 *
 * The geometry here is the single source of truth — `scripts/generate-icons.mjs`
 * reproduces it for the favicon, PWA icons and social card.
 */
export function Logo({ className, markOnly = false }: LogoProps) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[0.55rem] bg-brand-gradient text-primary-foreground shadow-sm">
        <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden="true">
          <path
            d="M7.2 17.28V6.72l9.6 10.56V6.72"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <g fill="currentColor">
            <circle cx="7.2" cy="6.72" r="2.1" />
            <circle cx="7.2" cy="17.28" r="2.1" />
            <circle cx="16.8" cy="6.72" r="2.1" />
            <circle cx="16.8" cy="17.28" r="2.1" />
          </g>
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
