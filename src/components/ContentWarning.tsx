import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { EyeOff, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAdultContent } from '@/hooks/useAdultContent';
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
  const preApproved = showAdult && !!event && isAdultContent(event);

  const [revealed, setRevealed] = useState(false);
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
  if (!warning) return <>{children}</>;

  return (
    <ContentWarning
      warning={warning}
      event={event}
      className={className}
      opaque={opaque}
    >
      {children}
    </ContentWarning>
  );
}
