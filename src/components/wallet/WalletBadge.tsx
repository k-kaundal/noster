import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { formatSats } from '@/lib/zap';
import { cn } from '@/lib/utils';

/**
 * Balance chip in the header.
 *
 * Only rendered once an account exists. Showing a wallet affordance to people
 * who have not connected one would advertise a feature that does nothing yet,
 * and the connect flow needs a signature, which belongs to a deliberate action
 * in settings rather than the top of every page.
 */
export function WalletBadge({ className }: { className?: string }) {
  const { isConnected } = useLnbitsAuth();
  const { balanceSats, isLoading } = useLnbitsWallet();

  if (!isConnected) return null;

  return (
    <Link
      to="/settings"
      aria-label={`Wallet balance: ${balanceSats} sats`}
      className={cn(
        'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/50 sm:inline-flex',
        className
      )}
    >
      <Zap className="h-3.5 w-3.5 text-zap" />
      <span className="tabular">
        {isLoading ? '—' : formatSats(balanceSats)}
      </span>
    </Link>
  );
}
