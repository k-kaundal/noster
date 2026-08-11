import { useMemo } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuHistory } from '@/hooks/useCashuHistory';
import { useCashuWallet } from '@/hooks/useCashuWallet';
import { readMovements } from '@/lib/cashuStore';
import { cashuTransactions } from '@/lib/cashuProvider';
import {
  combineBalance,
  mergeTransactions,
  type WalletBalance,
  type WalletTransaction,
} from '@/lib/walletTransaction';

/**
 * Everything the wallet has done, in one shape.
 *
 * Only Cashu is wired in so far. The lightning side — pay links, NWC, zaps —
 * reports through its own APIs and joins here the same way once each grows a
 * provider; the UI above does not change when it does, which is the point of
 * normalising rather than rendering each backend's own records.
 */
export function useWalletTransactions() {
  const { user } = useCurrentUser();
  const { balanceSats: cashuSats } = useCashuWallet();
  const { data: history, isLoading } = useCashuHistory();

  const transactions = useMemo<WalletTransaction[]>(() => {
    if (!user?.pubkey) return [];

    return mergeTransactions([
      cashuTransactions(readMovements(user.pubkey), history ?? []),
    ]);
  }, [user?.pubkey, history]);

  return {
    transactions,
    isLoading,
    cashuSats,
  };
}

/**
 * The two balances, and their sum.
 *
 * Kept apart rather than added and forgotten: ecash is bearer tokens from one
 * mint, and paying a lightning invoice with it means melting first. A single
 * figure would tell somebody they can pay an invoice with money that has to be
 * converted before it can go anywhere.
 */
export function useWalletBalance(lightningSats: number): WalletBalance {
  const { balanceSats: cashuSats } = useCashuWallet();

  return useMemo(
    () => combineBalance(lightningSats, cashuSats),
    [lightningSats, cashuSats]
  );
}
