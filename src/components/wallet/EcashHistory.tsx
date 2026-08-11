import { ArrowDownLeft, ArrowUpRight, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCashuHistory } from '@/hooks/useCashuHistory';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

/**
 * What the balance has done, from the kind 7376 events the wallet publishes.
 *
 * Read from relays, so it survives this device — which is the reason the
 * events exist. A local log would be faster and would be missing in exactly
 * the situation someone goes looking for one.
 */
export function EcashHistory({ className }: { className?: string }) {
  const { data: entries, isLoading } = useCashuHistory();

  if (!isLoading && !entries?.length) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <History className="h-4 w-4 text-primary" />
          </div>
          History
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Kept on your relays, encrypted to you. It follows your key rather than
          this browser.
        </p>
      </CardHeader>

      <CardContent className="space-y-1">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        ) : (
          entries?.map((entry) => {
            const incoming = entry.direction === 'in';

            return (
              <div
                key={entry.event.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
              >
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    incoming ? 'bg-success/10' : 'bg-muted'
                  )}
                >
                  {incoming ? (
                    <ArrowDownLeft className="h-4 w-4 text-success-strong" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {incoming ? 'Received' : 'Sent'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {relativeTime(entry.createdAt * 1000)}
                  </p>
                </div>

                {/*
                  A nutzap redemption is worth marking: the money arrived
                  because somebody zapped, not because a token was pasted in.
                */}
                {entry.redeemed.length > 0 && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    nutzap
                  </Badge>
                )}

                <p
                  className={cn(
                    'shrink-0 font-mono text-sm font-medium tabular-nums',
                    incoming && 'text-success-strong'
                  )}
                >
                  {incoming ? '+' : '−'}
                  {entry.amount.toLocaleString()}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {entry.unit}
                  </span>
                </p>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
