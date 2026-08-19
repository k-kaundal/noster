import { Wallet, Zap } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCreatorRevenue } from '@/hooks/useCreatorRevenue';
import { reconcile } from '@/lib/creatorRevenue';
import { formatSats } from '@/lib/zap';

/**
 * The other half of the earnings picture.
 *
 * Studio's headline figure is built from zap receipts found on relays, which
 * can only ever see money somebody announced to Nostr. A creator selling a
 * name, taking a tip or being paid on a plain invoice earns money that page
 * structurally cannot count, and the gap between the two is the first thing
 * anybody asks about.
 *
 * So this shows the wallet's own ledger beside it, split by what the money was
 * for, with the overlap — zaps that landed here, and so appear in both — named
 * rather than added. Two readings of one business is the honest shape; one
 * combined total would double-count every zap paid to this wallet.
 */
export function WalletRevenue({
  days,
  relaySats,
}: {
  days: number;
  /** What the relay-based half counted for the same window, to compare. */
  relaySats: number;
}) {
  const { summary, walletName, isLoading, isError, truncated, isAvailable } =
    useCreatorRevenue(days);

  /*
   * No wallet, nothing to say. An empty ledger and no ledger at all are
   * different facts, and showing "0 sats" for the second is a lie about the
   * first — somebody paid through an address this app does not hold has
   * earnings, just not ones it can read.
   */
  if (!isAvailable) return null;

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  /*
   * A wallet that cannot be read says so. Silence here would be indisting-
   * uishable from having earned nothing, on the one page where that
   * difference is the whole point.
   */
  if (isError) {
    return (
      <Card className="border-dashed">
        <CardContent className="px-6 py-8 text-center text-sm text-muted-foreground">
          Couldn't read your wallet's payments just now. The figures above come
          from relays and are unaffected.
        </CardContent>
      </Card>
    );
  }

  const balance = reconcile(summary, relaySats);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            Settled in {walletName || 'your wallet'}
          </span>
          <span className="text-sm tabular-nums">
            <span className="font-medium">{formatSats(summary.sats)}</span>
            <span className="text-muted-foreground"> sats</span>
            {summary.change !== null && (
              <span className="ml-2 text-xs text-muted-foreground">
                {summary.change >= 0 ? '+' : ''}
                {summary.change}% vs previous
              </span>
            )}
          </span>
        </div>

        {summary.bySource.length ? (
          <div className="divide-y">
            {summary.bySource.map((row) => (
              <div
                key={row.id}
                className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                  {/*
                    Marked as a multiplier, not left bare. Two numbers on one
                    row with nothing between them read as one number, and a
                    count sitting beside an amount in sats is the pair most
                    worth not confusing.
                  */}
                  <span className="text-xs text-muted-foreground">
                    ×{row.count.toLocaleString()}
                  </span>
                  <span>{row.sats.toLocaleString()}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing settled in this wallet during this period.
          </p>
        )}
      </div>

      {/*
        The sentence that stops the two numbers looking like a contradiction.

        Said as two directions rather than one difference, because they mean
        opposite things: money here that Nostr never heard about is revenue the
        headline figure misses, while zaps on relays that never arrived here
        were paid to an address this wallet does not hold.
      */}
      <div className="space-y-1.5 rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        {summary.zapSats > 0 && (
          <p className="flex items-start gap-2">
            <Zap className="mt-px h-3.5 w-3.5 shrink-0 text-zap" />
            {/*
              The subject is the amount, not the payments — so this reads the
              same whether it was one zap or a thousand
            */}
            <span>
              {formatSats(summary.zapSats)} sats of this arrived as zaps, so it
              is already counted in the figures above — these two totals
              overlap and should not be added.
            </span>
          </p>
        )}

        {balance.walletOnlySats > 0 && (
          <p>
            <span className="text-foreground">
              {formatSats(balance.walletOnlySats)} sats
            </span>{' '}
            landed here without a zap attached — names, tips and invoices that
            the relay figures above cannot see.
          </p>
        )}

        {balance.relayOnlySats > 0 && (
          <p>
            <span className="text-foreground">
              {formatSats(balance.relayOnlySats)} sats
            </span>{' '}
            of zaps were counted from relays but did not settle in this wallet
            — those were paid to a lightning address held somewhere else.
          </p>
        )}

        {truncated && (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="cursor-default underline decoration-dotted underline-offset-2">
                This wallet has more history than one read returns.
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Payments are read in one page. A wallet busy enough to fill it may
              have earnings older than this window that are not in the total —
              so treat this as a floor, not a ceiling.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
