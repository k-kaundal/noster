import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { lnbitsRequest, type LnbitsPayment } from '@/lib/lnbits';
import {
  isOpenRequest,
  readPayment,
  totals,
  type WalletPayment,
} from '@/lib/payments';

/** A month, which is the window the summary line reports on. */
const WINDOW_MS = 30 * 86_400_000;

/**
 * Everything the lightning wallet has done, and everything it is still waiting
 * for.
 *
 * Two things separate this from the raw payments query it replaces. It reads
 * the rows into a model that can tell a payment from an unpaid request, and it
 * polls while any request is open — an invoice on screen that has quietly been
 * paid is the one state a wallet must never sit in, and nothing else tells the
 * page it happened.
 */
export function useWalletActivity(limit = 100) {
  const { wallet } = useLnbitsWallet();

  const query = useQuery<LnbitsPayment[]>({
    queryKey: ['lnbits-payments', wallet?.id ?? '', limit],
    queryFn: ({ signal }) =>
      lnbitsRequest<LnbitsPayment[]>(
        `/api/v1/payments?limit=${limit}&direction=desc`,
        { apiKey: wallet!.inkey, signal }
      ),
    enabled: !!wallet,
    staleTime: 30 * 1000,
    /**
     * Faster while something is outstanding, idle otherwise. Written against
     * the query's own data so it reacts to a request settling without the
     * component having to arrange a refetch.
     */
    refetchInterval: (self) =>
      (self.state.data ?? []).some((raw) => isOpenRequest(readPayment(raw)))
        ? 10_000
        : false,
  });

  const payments = useMemo<WalletPayment[]>(() => {
    const now = Date.now();

    return (query.data ?? [])
      .map((raw) => readPayment(raw, now))
      .filter((payment) => !!payment.id)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [query.data]);

  const open = useMemo(() => payments.filter(isOpenRequest), [payments]);

  const month = useMemo(
    () => totals(payments, Date.now() - WINDOW_MS),
    [payments]
  );

  return {
    payments,
    /** Invoices still waiting, newest first — the wallet's to-do list. */
    openRequests: open,
    /** What moved in the last thirty days. */
    month,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
