import { Zap } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { ZapTrigger } from '@/components/ZapTrigger';
import { Button } from '@/components/ui/button';
import { useZaps } from '@/hooks/useZaps';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { cn } from '@/lib/utils';

interface ZapButtonProps {
  target: NostrEvent;
  className?: string;
  showCount?: boolean;
  zapData?: { count: number; totalSats: number; isLoading?: boolean };
}

/**
 * Zapping whatever is on the page — an article, a listing, an event, a
 * community — where there is no row of note actions to sit in.
 */
export function ZapButton({
  target,
  className,
  showCount = true,
  zapData: externalZapData,
}: ZapButtonProps) {
  const { user } = useCurrentUser();
  const { data: author } = useAuthor(target?.pubkey || '');

  // Only fetch data if not provided externally
  const { totalSats: fetchedTotalSats, isLoading } = useZaps(
    externalZapData ? [] : (target ?? []) // Empty array prevents fetching if external data provided
  );

  // Don't show zap button if user is not logged in, is the author, or author has no lightning address
  if (
    !user ||
    !target ||
    user.pubkey === target.pubkey ||
    (!author?.metadata?.lud16 && !author?.metadata?.lud06)
  ) {
    return null;
  }

  // Use external data if provided, otherwise use fetched data
  const totalSats = externalZapData?.totalSats ?? fetchedTotalSats;
  const showLoading = externalZapData?.isLoading || isLoading;

  return (
    <ZapTrigger target={target}>
      <Button
        variant="ghost"
        size="sm"
        className={cn('gap-1.5 text-zap hover:bg-zap/10', className)}
      >
        <Zap className="h-4 w-4" />
        <span className="text-xs tabular-nums">
          {showLoading
            ? '...'
            : showCount && totalSats > 0
              ? totalSats.toLocaleString()
              : 'Zap'}
        </span>
      </Button>
    </ZapTrigger>
  );
}
