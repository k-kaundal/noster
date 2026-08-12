import { Coins, Zap } from 'lucide-react';
import { FiatValue } from '@/components/FiatValue';
import { Skeleton } from '@/components/ui/skeleton';
import { combineBalance } from '@/lib/walletTransaction';
import { cn } from '@/lib/utils';

/**
 * One total, and what it is made of.
 *
 * The split is not a detail. Ecash is bearer tokens from one mint and
 * lightning is a balance somewhere that can pay anyone — showing only the sum
 * would tell somebody they have enough to pay an invoice when part of that
 * money has to be melted before it can go anywhere. The total answers "how
 * much do I have"; the two lines under it answer "what can I do with it".
 */
export function WalletBalance({
  lightningSats,
  cashuSats,
  isLoading,
  className,
}: {
  lightningSats: number;
  cashuSats: number;
  isLoading?: boolean;
  className?: string;
}) {
  const balance = combineBalance(lightningSats, cashuSats);

  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        <Skeleton className="h-12 w-48 rounded-lg" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div>
        <p className="text-5xl font-bold tracking-tight tabular-nums">
          {balance.total.toLocaleString()}
          <span className="ml-3 text-lg font-normal text-muted-foreground">
            sats
          </span>
        </p>
        <FiatValue sats={balance.total} className="mt-1 block text-sm" />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        <span className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-zap" />
          <span className="font-medium tabular-nums">
            {balance.lightning.toLocaleString()}
          </span>
          <span className="text-muted-foreground">Lightning</span>
        </span>

        <span className="flex items-center gap-1.5">
          <Coins className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium tabular-nums">
            {balance.cashu.toLocaleString()}
          </span>
          <span className="text-muted-foreground">Cashu</span>
        </span>
      </div>
    </div>
  );
}
