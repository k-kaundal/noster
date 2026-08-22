import { ChevronDown, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeSpamReason, type SpamReason } from '@/lib/campaignSpam';
import { cn } from '@/lib/utils';

/**
 * How many notes the timeline held back, and what for.
 *
 * The same bargain the notifications list already makes: nothing is deleted,
 * the reason is named, and looking is one tap. A filter somebody cannot
 * inspect is indistinguishable from a bug — and the note it gets wrong is, by
 * definition, the one they most needed to see.
 *
 * Deliberately quiet. This sits under the feed rather than above it, because
 * the notes that were kept are what somebody came for, and a warning banner
 * over the top of them makes a clean timeline feel like a problem.
 */
export function FilteredNotice({
  count,
  reasons,
  open,
  onToggle,
  className,
}: {
  count: number;
  reasons: Map<string, SpamReason[]>;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  if (!count) return null;

  /*
   * Named by the commonest reason rather than per row. "Filtered" alone reads
   * as censorship; "the same message was sent by several accounts" is a claim
   * somebody can check against what they see when they open it.
   */
  const counts = new Map<SpamReason, number>();
  for (const list of reasons.values()) {
    for (const reason of list) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return (
    <Button
      variant="ghost"
      onClick={onToggle}
      className={cn(
        'w-full justify-between text-xs text-muted-foreground',
        className
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {count === 1 ? '1 note held back' : `${count} notes held back`}
          {commonest ? ` — ${describeSpamReason(commonest).toLowerCase()}` : ''}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {open ? 'Hide' : 'Show'}
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </span>
    </Button>
  );
}
