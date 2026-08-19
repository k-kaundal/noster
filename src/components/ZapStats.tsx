import { useState } from 'react';
import { CloudOff, ShieldQuestion, Zap, ZapOff } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { ZapActivityDialog } from '@/components/ZapActivityDialog';
import { useZapSummary } from '@/hooks/useZapSummary';
import { useReceiptCount } from '@/hooks/useReceiptCount';
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
 * kind of number that makes an author feel watched rather than paid. But
 * "nothing to say" is now a narrower claim than it was: a receipt that was
 * refused, and a receipt the relay holds that never arrived here, are both
 * things to say — see below.
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

  /*
   * The relay's own tally, asked for over NIP-45.
   *
   * Only ever used to find receipts this app did not get. Never to replace the
   * total: a COUNT is a count of events tagged with this note, checked against
   * nothing — anyone can publish one — so quoting it as an earnings figure
   * would undo every validation the summary performs.
   *
   * Costs one message, and only on relays that advertise COUNT. This component
   * renders on detail screens rather than in feeds, so that is one per page.
   */
  const { data: relayCount } = useReceiptCount(summary.target);
  const missing = relayCount ? Math.max(0, relayCount.count - summary.received) : 0;

  const markers = (
    <>
      {/*
        Counted, but signed by a key this browser did not expect.

        Shown rather than hidden, and shown rather than used to delete the
        zap: the provider key is remembered from payments made here, so it is
        missing for most of the network and stale for some of the rest. The
        honest report is the total plus a note that part of it could not be
        proved.
      */}
      {summary.unverified > 0 && (
        <Marker
          icon={ShieldQuestion}
          value={summary.unverified}
          label={`${summary.unverified} unproved`}
        >
          {summary.unverified === 1 ? 'One zap is' : `${summary.unverified} zaps are`}{' '}
          counted but unproved: the receipt was signed by a key this browser
          has not seen from that lightning address. Usually the address's
          server changed keys.
        </Marker>
      )}

      {/*
        Receipts the relay holds that never reached this app.

        The one failure the app could not previously see, and the one behind
        almost every "I paid and it does not show". It is not a validation
        problem at all — the receipt was never judged, because it never
        arrived — and without this the two were indistinguishable from here.
      */}
      {missing > 0 && (
        <Marker icon={CloudOff} value={missing} label={`${missing} not loaded`}>
          The relay holds {relayCount!.count}{' '}
          {relayCount!.count === 1 ? 'receipt' : 'receipts'} for this post but{' '}
          {summary.received === 1 ? 'only one' : `only ${summary.received}`}{' '}
          reached this app, so {missing === 1 ? 'one is' : `${missing} are`}{' '}
          missing from the total. Reloading usually fetches{' '}
          {missing === 1 ? 'it' : 'them'}.
        </Marker>
      )}
    </>
  );

  /**
   * A refused receipt is shown, not swallowed.
   *
   * This returned `null` whenever the count was zero, so a note whose only
   * receipt failed validation rendered nothing at all — indistinguishable
   * from a note nobody had zapped. That is the exact shape of "I paid and it
   * does not show", and it left the person who paid with no thread to pull.
   */
  if (!summary.count) {
    if (!summary.rejected.length && !missing) return null;

    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        {!!summary.rejected.length && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-muted-foreground">
                <ZapOff className="h-4 w-4 shrink-0" />
                {summary.rejected.length === 1
                  ? '1 zap not counted'
                  : `${summary.rejected.length} zaps not counted`}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              A zap receipt reached this app and failed a NIP-57 check, so it
              is not in the total.{' '}
              <span className="font-mono text-[11px]">
                {[...new Set(summary.rejected.map((entry) => entry.reason))].join(', ')}
              </span>
            </TooltipContent>
          </Tooltip>
        )}
        {markers}
      </span>
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

      {markers}

      <ZapActivityDialog
        summary={summary}
        missing={missing}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

/**
 * A small count with an explanation behind it.
 *
 * Deliberately quiet — muted, tiny, never coloured. These sit beside a total
 * somebody earned, and a warning badge shouting next to it would read as an
 * accusation about the money rather than a note about this app's view of it.
 */
function Marker({
  icon: Icon,
  value,
  label,
  children,
}: {
  icon: typeof ShieldQuestion;
  value: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1 px-1 text-[11px] text-muted-foreground"
          aria-label={label}
        >
          <Icon className="h-3.5 w-3.5" />
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{children}</TooltipContent>
    </Tooltip>
  );
}
