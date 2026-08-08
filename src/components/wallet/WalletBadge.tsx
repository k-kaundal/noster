import { Link } from 'react-router-dom';
import { Wallet, Zap } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { formatSats } from '@/lib/zap';
import { cn } from '@/lib/utils';

/**
 * Wallet chip in the header.
 *
 * Shown to anyone signed in, not only to those who already have a wallet.
 * Hiding it until connected meant the only route to a wallet was a tab inside
 * settings, so someone with no wallet saw nothing suggesting one existed —
 * the state that most needs a way in had the fewest.
 */
export function WalletBadge({ className }: { className?: string }) {
  const { user } = useCurrentUser();
  const { isConnected } = useLnbitsAuth();
  const { balanceSats, isLoading } = useLnbitsWallet();

  if (!user) return null;

  return (
    <Link
      to="/wallet"
      aria-label={
        isConnected ? `Wallet balance: ${balanceSats} sats` : 'Set up your wallet'
      }
      className={cn(
        'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/50 sm:inline-flex',
        className
      )}
    >
      {isConnected ? (
        <>
          <Zap className="h-3.5 w-3.5 text-zap" />
          <span className="tabular">
            {isLoading ? '—' : formatSats(balanceSats)}
          </span>
        </>
      ) : (
        <>
          <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Wallet</span>
        </>
      )}
    </Link>
  );
}
