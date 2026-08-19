import { useMemo } from 'react';

import { useLnbitsPayments, useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import {
  EMPTY_REVENUE,
  summarizeRevenue,
  type RevenueSummary,
} from '@/lib/creatorRevenue';

/**
 * How far back a single read reaches.
 *
 * A cap on the request, not on the earnings. Everything here is computed from
 * the payments actually fetched, so a very busy wallet sees a window that ends
 * where this list does — which the page says out loud rather than quietly
 * reporting a smaller total.
 */
const LIMIT = 500;

/**
 * The wallet's own takings, as the ledger recorded them.
 *
 * Reads through `useLnbitsPayments` rather than issuing its own request: the
 * wallet page is already fetching this list with the same key, so composing
 * shares one cache entry instead of asking LNbits the same question twice. It
 * also inherits that hook's invoice-key access — the admin key can spend, and
 * a page that only counts payments has no business holding it.
 */
export function useCreatorRevenue(windowDays: number) {
  const { wallet } = useLnbitsWallet();
  const query = useLnbitsPayments(LIMIT);

  const payments = useMemo(() => query.data ?? [], [query.data]);

  const summary: RevenueSummary = useMemo(
    () =>
      payments.length ? summarizeRevenue(payments, windowDays) : EMPTY_REVENUE,
    [payments, windowDays]
  );

  return {
    summary,
    /** Which wallet these figures describe, so the page can name it. */
    walletName: wallet?.name ?? '',
    isLoading: query.isLoading,
    isError: query.isError,
    /**
     * Whether the read hit its cap, and so may not reach back far enough to
     * cover the window being shown.
     */
    truncated: payments.length >= LIMIT,
    /** No wallet connected: the section has nothing to describe, not zero. */
    isAvailable: !!wallet,
  };
}
