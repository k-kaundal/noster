import {
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { EyeOff, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAdultContent } from '@/hooks/useAdultContent';
import { useFriendReports } from '@/hooks/useFriendReports';
import { describeReports, shouldBlurMedia } from '@/lib/reports';
import { isAdultContent } from '@/lib/nsfw';
import {
  categoryLabels,
  describeWarning,
  type ContentWarning as Warning,
  type WarningSeverity,
} from '@/lib/contentWarning';
import type { NostrEvent } from '@nostrify/nostrify';
import { cn } from '@/lib/utils';

interface ContentWarningProps {
  /** The parsed NIP-36 warning. */
  warning: Warning;
  /**
   * The event it came from, when there is one. Only used to ask whether the
   * reader already opted into this kind of content, so a bio or a preview can
   * leave it out.
   */
  event?: NostrEvent;
  children: ReactNode;
  className?: string;
  /** Cover the whole thing rather than showing a blurred preview behind it. */
  opaque?: boolean;
}

const SEVERITY_CONFIG: Record<
  WarningSeverity,
  { label: string; color: string; blur: string }
> = {
  mild: {
    label: 'Content warning',
    color: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
    blur: 'blur-sm',
  },
  moderate: {
    label: 'Sensitive content',
    color: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
    blur: 'blur-md',
  },
  explicit: {
    label: 'Explicit content',
    /**
     * Only the strongest blur is enough here. The lighter ones leave shapes
     * and colour readable, which for this severity is most of the problem
     * still on screen.
     */
    color: 'bg-red-500/20 text-red-700 dark:text-red-400',
    blur: 'blur-2xl',
  },
};

/**
 * Keeps a click on the gate from reaching whatever is behind it.
 *
 * A quoted note and an article card are both wrapped in a link, so without
 * this, "Show anyway" navigates away instead of revealing — the one button on
 * screen that must not take you somewhere else.
 */
function swallow(action: () => void) {
  return (clicked: ReactMouseEvent) => {
    clicked.preventDefault();
    clicked.stopPropagation();
    action();
  };
}

/**
 * The NIP-36 gate.
 *
 * The content stays mounted behind a blur rather than being withheld, so
 * revealing it is instant and the layout does not jump. Which means the words
 * are in the DOM while covered — fine for a warning, which is a courtesy the
 * author asked for, and not a security boundary.
 */
export function ContentWarning({
  warning,
  event,
  children,
  className,
  opaque = false,
}: ContentWarningProps) {
  const { showAdult } = useAdultContent();

  /**
   * Someone who turned adult content on has already answered this question.
   * Asking again on every post is the client ignoring a setting it offered.
   * Only for adult warnings, though: opting into nudity is not opting into
   * gore, and it says nothing at all about spoilers.
   */
  const adult = !!event && isAdultContent(event);
  const preApproved = showAdult && adult;

  const [revealed, setRevealed] = useState(false);

  /**
   * Turning adult content off closes what it opened.
   *
   * `revealed` is per-post state and it outlived the setting: somebody who
   * uncovered a post, then switched adult content off, was left looking at the
   * thing they had just asked to stop seeing — and on a shared screen that is
   * the exact moment the switch is being reached for. Only for adult posts;
   * revealing a spoiler is not a decision this setting has any say over.
   */
  useEffect(() => {
    if (!showAdult && adult) setRevealed(false);
  }, [showAdult, adult]);
  const config = SEVERITY_CONFIG[warning.severity];
  const reason = describeWarning(warning);
  const categories = categoryLabels(warning);

  if (revealed || preApproved) {
    return (
      <div className={className}>
        {!preApproved && (
          <button
            type="button"
            onClick={swallow(() => setRevealed(false))}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <EyeOff className="h-3.5 w-3.5" />
            Hide again
          </button>
        )}
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-amber-200 dark:border-amber-800',
        className
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none max-h-48 select-none overflow-hidden saturate-50',
          config.blur,
          // Nothing of an explicit post should be legible through the cover
          opaque && 'opacity-0'
        )}
      >
        {children}
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/75 p-4 text-center backdrop-blur-sm">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Badge className={config.color} variant="secondary">
              {config.label}
            </Badge>
            {/*
              The categories, when they are not already the whole caption —
              repeating "Nudity" as a chip under the words "Nudity" is noise.
            */}
            {reason !== categories.join(' · ') &&
              categories.map((label) => (
                <Badge key={label} variant="outline" className="font-normal">
                  {label}
                </Badge>
              ))}
          </div>
          {reason && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{reason}</p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={swallow(() => setRevealed(true))}
          className="gap-2"
        >
          <Eye className="h-4 w-4" />
          Show anyway
        </Button>
      </div>
    </div>
  );
}

/**
 * Wraps children in a gate only when the event carries a warning.
 *
 * Saves every call site from repeating the same conditional, and — more to the
 * point — makes the safe thing the short thing to write, so a new render path
 * does not quietly ship without a gate.
 *
 * A gate can also come from outside the event. NIP-56 suggests exactly one
 * automatic response to reports — "if 3+ of your friends report a profile for
 * nudity, clients can have an option to automatically blur photos" — and this
 * is where that lands, because every render path that shows a note already
 * passes through here. Wiring it into each call site instead would mean the
 * next one added silently opts out.
 */
export function MaybeWarned({
  event,
  warning,
  children,
  className,
  opaque,
}: {
  event: NostrEvent;
  warning: Warning | null;
  children: ReactNode;
  className?: string;
  opaque?: boolean;
}) {
  const reports = useFriendReports();

  /**
   * The author's own warning wins when there is one. They said what it is,
   * and replacing their words with a count of who complained is both less
   * informative and a small insult.
   */
  const reported =
    !warning &&
    (shouldBlurMedia(reports.forEvent(event.id)) ||
      shouldBlurMedia(reports.forPubkey(event.pubkey)));

  const effective: Warning | null =
    warning ??
    (reported
      ? {
          reason: describeReports(
            reports.forEvent(event.id) ?? reports.forPubkey(event.pubkey)!
          ),
          categories: ['nudity'],
          severity: 'moderate',
        }
      : null);

  if (!effective) return <>{children}</>;

  return (
    <ContentWarning
      warning={effective}
      event={event}
      className={className}
      opaque={opaque}
    >
      {children}
    </ContentWarning>
  );
}
