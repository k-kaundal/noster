import { History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TransactionCard } from '@/components/wallet/TransactionCard';
import { useWalletTransactions } from '@/hooks/useWalletTransactions';
import { cn } from '@/lib/utils';

/**
 * The wallet's history, in one list.
 *
 * Reads the normalised model rather than any backend's own records, so a row
 * says what happened — minted, melted, sent, zapped — instead of an amount
 * with no story attached.
 */
export function TransactionList({ className }: { className?: string }) {
  const { transactions, isLoading } = useWalletTransactions();

  if (!isLoading && !transactions.length) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <History className="h-4 w-4 text-primary" />
          </div>
          History
        </CardTitle>
      </CardHeader>

      <CardContent className={cn('space-y-0.5')}>
        {isLoading ? (
          <>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </>
        ) : (
          transactions
            .slice(0, 50)
            .map((transaction) => (
              <TransactionCard key={transaction.id} transaction={transaction} />
            ))
        )}
      </CardContent>
    </Card>
  );
}
