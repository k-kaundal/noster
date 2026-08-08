import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
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

  const wallet = list[0] ?? null;
  const balanceSats = wallet ? msatToSat(wallet.balance_msat) : 0;

  const createWallet = useMutation({
    mutationFn: (name: string) =>
      lnbitsRequest<LnbitsWallet>('/api/v1/wallet', {
        method: 'POST',
        token,
        body: { name, wallet_type: 'lightning' },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lnbits-wallets'] });
      queryClient.invalidateQueries({ queryKey: ['lnbits-account'] });
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
    balanceSats,
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
