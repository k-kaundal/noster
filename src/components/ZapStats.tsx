import { useState } from 'react';
import { ShieldQuestion, Zap, ZapOff } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { ZapActivityDialog } from '@/components/ZapActivityDialog';
import { useZapSummary } from '@/hooks/useZapSummary';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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

  /**
   * A refused receipt is shown, not swallowed.
   *
   * This returned `null` whenever the count was zero, so a note whose only
   * receipt failed validation rendered nothing at all — indistinguishable
   * from a note nobody had zapped. That is the exact shape of "I paid and it
   * does not show", and it left the person who paid with no thread to pull.
   */
  if (!summary.count) {
    if (!summary.rejected.length) return null;

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-muted-foreground',
              className
            )}
          >
            <ZapOff className="h-4 w-4 shrink-0" />
            {summary.rejected.length === 1
              ? '1 zap not counted'
              : `${summary.rejected.length} zaps not counted`}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          A zap receipt reached this app and failed a NIP-57 check, so it is
          not in the total.{' '}
          <span className="font-mono text-[11px]">
            {[...new Set(summary.rejected.map((entry) => entry.reason))].join(', ')}
          </span>
        </TooltipContent>
      </Tooltip>
    );
  }

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

      {/*
        Counted, but signed by a key this browser did not expect.

        Shown rather than hidden, and shown rather than used to delete the
        zap: the provider key is remembered from payments made here, so it is
        missing for most of the network and stale for some of the rest. The
        honest report is the total plus a note that part of it could not be
        proved.
      */}
      {summary.unverified > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
              <ShieldQuestion className="h-3.5 w-3.5" />
              {summary.unverified}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {summary.unverified === 1 ? 'One zap is' : `${summary.unverified} zaps are`}{' '}
            counted but unproved: the receipt was signed by a key this browser
            has not seen from that lightning address. Usually the address's
            server changed keys.
          </TooltipContent>
        </Tooltip>
      )}

      <ZapActivityDialog summary={summary} open={open} onOpenChange={setOpen} />
    </>
  );
}
