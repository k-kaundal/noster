import { BadgeCheck, Gem, ShieldCheck, Zap } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  RELAY_MEMBER,
  describeTier,
  type NameTier,
  type TierCopy,
  type UserStanding,
} from '@/lib/tiers';

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
  /*
   * Its own shape, not only its own colour. A premium mark separated from the
   * verified one by hue alone is two identical marks to a colourblind reader,
   * and this pair has to be told apart at 16px in a timeline.
   */
  premium: {
    className: 'text-primary',
    ring: 'bg-primary/15',
  },
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
  gem: Gem,
  shield: ShieldCheck,
} as const;

/** The relay mark's own colours, since it is not one of the name tiers. */
const RELAY_STYLE = { className: 'text-zap', ring: 'bg-zap/15' };

export function VerificationMark({
  tier,
  domain,
  className,
}: {
  tier: NameTier;
  domain?: string;
  className?: string;
}) {
  const copy = describeTier(tier, { domain });
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
  domain,
  className,
}: {
  tier: NameTier;
  /** Where the name is, so the copy can name it. */
  domain?: string;
  className?: string;
}) {
  const copy = describeTier(tier, { domain });
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

/**
 * The mark for relay admission, which is not a name tier.
 *
 * Its own component rather than a fourth rung, because it answers a different
 * question. A name says who somebody is; this says a relay takes their writes.
 * Somebody can have either without the other, and a scale that put them in one
 * order would have to claim one is worth more than the other.
 */
export function RelayMark({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn('inline-flex', RELAY_STYLE.className, className)}
          aria-label={RELAY_MEMBER.label}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">{RELAY_MEMBER.label}</p>
        <p className="text-xs text-muted-foreground">{RELAY_MEMBER.blurb}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Everything somebody has bought, as separate marks.
 *
 * Two marks rather than one combined one, deliberately. A premium name and a
 * free address with relay admission are different people who did different
 * things, and any single mark covering both would draw them identically —
 * which is the failure the profile header already avoids by giving the NIP-05
 * ✓ and the address tier their own marks.
 *
 * `admitted` is only ever read as true. Undefined means nobody asked, which is
 * most of the app, and false means the relay said no — neither is something to
 * put a mark on, and only the first is worth a mark's absence being silent.
 */
export function StandingMarks({
  standing,
  domain,
  className,
}: {
  standing: UserStanding;
  /** Where the name is, so the tooltip can name it. */
  domain?: string;
  className?: string;
}) {
  if (!standing.tier && !standing.admitted) return null;

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {standing.tier && (
        <VerificationMark tier={standing.tier} domain={domain} />
      )}
      {standing.admitted && <RelayMark />}
    </span>
  );
}

/**
 * The same pair written out, for a card or a hover with room.
 *
 * Ordered name first, since that is the one somebody reads as identity; the
 * relay is a fact about where they post.
 */
export function StandingBadges({
  standing,
  domain,
  className,
}: {
  standing: UserStanding;
  /** Where the name is, so the copy can say where to buy the ✓. */
  domain?: string;
  className?: string;
}) {
  if (!standing.tier && !standing.admitted) return null;

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      {standing.tier && (
        <VerificationBadge tier={standing.tier} domain={domain} />
      )}
      {standing.admitted && <PlainBadge copy={RELAY_MEMBER} style={RELAY_STYLE} />}
    </span>
  );
}

function PlainBadge({
  copy,
  style,
}: {
  copy: TierCopy;
  style: { className: string; ring: string };
}) {
  const Icon = MARKS[copy.mark];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            style.ring,
            style.className
          )}
        >
          <Icon className="h-3 w-3" aria-hidden />
          {copy.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{copy.blurb}</p>
      </TooltipContent>
    </Tooltip>
  );
}
