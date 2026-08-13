import { useState } from 'react';
import { Zap } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { ZapActivityDialog } from '@/components/ZapActivityDialog';
import { useZapSummary } from '@/hooks/useZapSummary';
import { describeZapSummary } from '@/lib/zapSummary';
import { cn } from '@/lib/utils';

/**
 * What an event earned, on anything zappable.
 *
 * One component for notes, articles, videos and calendar events, because the
 * question is the same for all of them and the answer differs only in how the
 * event is addressed — which `useZapSummary` handles: a note by its id, an
 * addressable event by its coordinate.
 *
 * Renders nothing when there is nothing to say. A "0 sats" label on a post
 * nobody has zapped is a worse thing to look at than no label, and it is the
 * kind of number that makes an author feel watched rather than paid.
 */
export function ZapStats({
  event,
  className,
}: {
  event: NostrEvent;
  className?: string;
}) {
  const summary = useZapSummary(event);
  const [open, setOpen] = useState(false);

  if (!summary.count) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium text-zap transition-colors hover:bg-zap/10',
          className
        )}
      >
        <Zap className="h-4 w-4 shrink-0" />
        {describeZapSummary(summary)}
      </button>

      <ZapActivityDialog summary={summary} open={open} onOpenChange={setOpen} />
    </>
  );
}
