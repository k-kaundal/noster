import { BadgeCheck, Zap } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { describeTier, type NameTier } from '@/lib/tiers';

/**
 * The mark a tier wears, wherever it appears.
 *
 * One component rather than a badge invented per screen, because the whole
 * value of a mark is that it means the same thing in the timeline as it does
 * on the wallet page. A ✓ that appears next to two different things has told
 * the reader nothing.
 *
 * The free tier gets a mark too. It is the quieter of the two and it is still
 * a real statement: this person can be paid, which on most Nostr clients a new
 * account cannot.
 */
const STYLES: Record<NameTier, { className: string; ring: string }> = {
  named: {
    className: 'text-success',
    ring: 'bg-success/15',
  },
  /*
   * Quiet, not alarming. A name waiting to be bought is an offer, and dressing
   * it as a warning would tell somebody an address that works is broken.
   */
  unverified: {
    className: 'text-muted-foreground',
    ring: 'bg-muted',
  },
  assigned: {
    className: 'text-muted-foreground',
    ring: 'bg-muted',
  },
};

const MARKS = {
  check: BadgeCheck,
  dot: Zap,
} as const;

export function VerificationMark({
  tier,
  className,
}: {
  tier: NameTier;
  className?: string;
}) {
  const copy = describeTier(tier);
  const Icon = MARKS[copy.mark];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* A span rather than a button: it explains, it does not act, and a
            focusable element that does nothing is a trap for anybody moving
            through the page by keyboard. */}
        <span
          className={cn('inline-flex', STYLES[tier].className, className)}
          aria-label={copy.label}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">{copy.label}</p>
        <p className="text-xs text-muted-foreground">{copy.blurb}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** The same thing with its name written out, for somewhere with room. */
export function VerificationBadge({
  tier,
  className,
}: {
  tier: NameTier;
  className?: string;
}) {
  const copy = describeTier(tier);
  const Icon = MARKS[copy.mark];
  const style = STYLES[tier];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        style.ring,
        style.className,
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {copy.label}
    </span>
  );
}
