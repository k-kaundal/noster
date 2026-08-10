import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useAccountStored } from '@/hooks/useStore';
import { useToast } from '@/hooks/useToast';
import {
  lnbitsRequest,
  msatToSat,
  readBolt11,
  satToMsat,
  type LnbitsPayment,
  type LnbitsWallet,
} from '@/lib/lnbits';

/**
 * The signed-in user's LNbits wallets, and the operations against them.
 *
 * Wallet keys come from the session on every load and are never written to
 * storage. The admin key can spend, so the less time it exists outside memory
 * the better; the session token is the thing worth persisting, because it can
 * be revoked server-side and the keys can always be fetched again with it.
 */
export function useLnbitsWallet() {
  const { account, token, isConnected } = useLnbitsAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const wallets = useQuery<LnbitsWallet[]>({
    queryKey: ['lnbits-wallets', account?.id ?? ''],
    queryFn: ({ signal }) =>
      lnbitsRequest<LnbitsWallet[]>('/api/v1/wallets', { token, signal }),
    enabled: isConnected,
    // Balances move without us doing anything, so this stays fairly fresh
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });

  // The account response already carries wallets; use them until the
  // dedicated query lands, so a balance appears immediately after connecting.
  const list = useMemo(
    () => wallets.data ?? account?.wallets ?? [],
    [wallets.data, account]
  );

  /**
   * Which wallet the app is acting on.
   *
   * An LNbits account can hold any number of wallets — one for spending, one
   * for a shop, one kept apart from the rest — and this app only ever used the
   * first one the server happened to list. Every other wallet on the account
   * was invisible: no balance, no keys, and nothing to send from.
   *
   * Remembered per Nostr identity, because which wallet is "the" wallet is a
   * choice about this account and not about this browser.
   */
  const [activeId, setActiveId] = useAccountStored<string>('lnbits:wallet', '');

  /**
   * Falls back rather than showing nothing.
   *
   * A remembered id can name a wallet that has since been deleted, or one
   * belonging to a different LNbits account after signing in elsewhere. The
   * first wallet is a usable answer; an empty screen is not.
   */
  const wallet = list.find((entry) => entry.id === activeId) ?? list[0] ?? null;
  const balanceSats = wallet ? msatToSat(wallet.balance_msat) : 0;

  const totalBalanceSats = useMemo(
    () => list.reduce((sum, entry) => sum + msatToSat(entry.balance_msat), 0),
    [list]
  );

  const selectWallet = useCallback(
    (id: string) => {
      setActiveId(id);

      // Balances and history belong to the wallet that was showing
      queryClient.invalidateQueries({ queryKey: ['lnbits-payments'] });
      queryClient.invalidateQueries({ queryKey: ['lnurlp-links'] });
    },
    [setActiveId, queryClient]
  );

  const createWallet = useMutation({
    mutationFn: (name: string) =>
      lnbitsRequest<LnbitsWallet>('/api/v1/wallet', {
        method: 'POST',
        token,
        body: { name, wallet_type: 'lightning' },
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['lnbits-wallets'] });
      queryClient.invalidateQueries({ queryKey: ['lnbits-account'] });

      // Switch to it: nobody makes a wallet in order to keep using the old one
      if (created?.id) selectWallet(created.id);
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not create wallet',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /** Creates an invoice to receive sats. Uses the invoice key, which can't spend. */
  const createInvoice = useMutation({
    mutationFn: async ({
      amountSats,
      memo,
    }: {
      amountSats: number;
      memo?: string;
    }) => {
      if (!wallet) throw new Error('No wallet');

      const body = await lnbitsRequest<Record<string, unknown>>(
        '/api/v1/payments',
        {
          method: 'POST',
          apiKey: wallet.inkey,
          body: {
            out: false,
            amount: amountSats,
            unit: 'sat',
            memo: memo ?? '',
          },
        }
      );

      // This endpoint names the invoice `payment_request`, not `bolt11`
      return {
        paymentHash: String(body.payment_hash ?? ''),
        bolt11: readBolt11(body),
      };
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not create invoice',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /** Pays a bolt11 invoice. Needs the admin key. */
  const payInvoice = useMutation({
    mutationFn: async (bolt11: string) => {
      if (!wallet) throw new Error('No wallet');

      return lnbitsRequest<LnbitsPayment>('/api/v1/payments', {
        method: 'POST',
        apiKey: wallet.adminkey,
        body: { out: true, bolt11 },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lnbits-wallets'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Payment failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * Pays a lightning address or LNURL, with an optional comment.
   *
   * LNbits resolves the address and handles the LNURL callback itself, which
   * is what makes zapping from this wallet a single request rather than the
   * three round trips the client would otherwise make.
   */
  const payLnurl = useMutation({
    mutationFn: async ({
      lnurl,
      amountSats,
      comment,
    }: {
      lnurl: string;
      amountSats: number;
      comment?: string;
    }) => {
      if (!wallet) throw new Error('No wallet');

      return lnbitsRequest<LnbitsPayment>('/api/v1/payments/lnurl', {
        method: 'POST',
        apiKey: wallet.adminkey,
        body: {
          lnurl,
          // This endpoint takes millisats, unlike /payments which takes sats
          amount: satToMsat(amountSats),
          comment: comment ?? '',
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lnbits-wallets'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Payment failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    wallets: list,
    wallet,
    /** The wallet the app is acting on, resolved against what actually exists. */
    activeWalletId: wallet?.id ?? '',
    selectWallet,
    balanceSats,
    /** Every wallet on the account added together. */
    totalBalanceSats,
    isLoading: wallets.isLoading,
    createWallet: createWallet.mutateAsync,
    isCreatingWallet: createWallet.isPending,
    createInvoice: createInvoice.mutateAsync,
    isCreatingInvoice: createInvoice.isPending,
    payInvoice: payInvoice.mutateAsync,
    payLnurl: payLnurl.mutateAsync,
    isPaying: payInvoice.isPending || payLnurl.isPending,
  };
}

/**
 * Watches an invoice until it is paid.
 *
 * Polled rather than pushed: the wallet has no socket here, and an invoice on
 * screen with no idea whether it landed is the one thing that makes people
 * pay twice. Polling stops as soon as it settles.
 */
export function useInvoiceStatus(paymentHash: string | undefined) {
  const { wallet } = useLnbitsWallet();

  const query = useQuery<boolean>({
    queryKey: ['lnbits-invoice', paymentHash ?? ''],
    queryFn: async ({ signal }) => {
      const body = await lnbitsRequest<Record<string, unknown>>(
        `/api/v1/payments/${paymentHash}`,
        { apiKey: wallet!.inkey, signal }
      );

      // LNbits has reported this as `paid` and as `status: "success"`
      return body.paid === true || body.status === 'success';
    },
    enabled: !!paymentHash && !!wallet,
    refetchInterval: (query) => (query.state.data ? false : 3000),
    staleTime: 0,
    retry: false,
  });

  return { isPaid: query.data === true };
}

/** Recent payments for the active wallet. */
export function useLnbitsPayments(limit = 20) {
  const { wallet } = useLnbitsWallet();

  return useQuery<LnbitsPayment[]>({
    queryKey: ['lnbits-payments', wallet?.id ?? '', limit],
    queryFn: ({ signal }) =>
      lnbitsRequest<LnbitsPayment[]>(
        `/api/v1/payments?limit=${limit}&direction=desc`,
        { apiKey: wallet!.inkey, signal }
      ),
    enabled: !!wallet,
    staleTime: 30 * 1000,
  });
}
