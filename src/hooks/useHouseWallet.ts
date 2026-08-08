import { useMutation, useQuery } from '@tanstack/react-query';
import {
  HOUSE_WALLET,
  hasHouseWallet,
  lnbitsRequest,
  msatToSat,
  readBalanceMsat,
  readBolt11,
} from '@/lib/lnbits';

/**
 * The shared NostrFeed wallet, used only to receive.
 *
 * Its invoice key ships in the bundle, so this hook is deliberately limited to
 * what that key can do: read the balance, mint invoices, and check whether one
 * was paid. Nothing here can move money out, because nothing here has a key
 * that could.
 */
export function useHouseWallet() {
  const enabled = hasHouseWallet();

  const wallet = useQuery({
    queryKey: ['house-wallet', HOUSE_WALLET.id],
    queryFn: async ({ signal }) => {
      const body = await lnbitsRequest<Record<string, unknown>>(
        '/api/v1/wallet',
        { apiKey: HOUSE_WALLET.invoiceKey, signal }
      );

      return {
        id: String(body.id ?? HOUSE_WALLET.id),
        name: String(body.name ?? 'NostrFeed'),
        balanceMsat: readBalanceMsat(body),
      };
    },
    enabled,
    staleTime: 30 * 1000,
  });

  const createInvoice = useMutation({
    mutationFn: async ({
      amountSats,
      memo,
      expirySeconds,
    }: {
      amountSats: number;
      memo?: string;
      expirySeconds?: number;
    }) => {
      const body = await lnbitsRequest<Record<string, unknown>>(
        '/api/v1/payments',
        {
          method: 'POST',
          apiKey: HOUSE_WALLET.invoiceKey,
          body: {
            out: false,
            amount: amountSats,
            unit: 'sat',
            memo: memo ?? '',
            ...(expirySeconds ? { expiry: expirySeconds } : {}),
          },
        }
      );

      return {
        paymentHash: String(body.payment_hash ?? ''),
        bolt11: readBolt11(body),
      };
    },
  });

  return {
    enabled,
    wallet: wallet.data ?? null,
    balanceSats: wallet.data ? msatToSat(wallet.data.balanceMsat) : 0,
    isLoading: wallet.isLoading,
    createInvoice: createInvoice.mutateAsync,
    isCreatingInvoice: createInvoice.isPending,
  };
}

/**
 * Polls an invoice until it is paid.
 *
 * LNbits also exposes a websocket keyed by the invoice key, which would avoid
 * polling entirely — but that key is the URL, so opening the socket would put
 * it in browser history and any proxy log along the way. Polling costs a
 * request every few seconds and leaks nothing extra.
 */
export function useInvoiceStatus(paymentHash: string | undefined) {
  return useQuery({
    queryKey: ['invoice-status', paymentHash],
    queryFn: async ({ signal }) => {
      const body = await lnbitsRequest<Record<string, unknown>>(
        `/api/v1/payments/${paymentHash}`,
        { apiKey: HOUSE_WALLET.invoiceKey, signal }
      );

      // Documented as `{paid}`; newer builds report `status: "success"`
      return body.paid === true || body.status === 'success';
    },
    enabled: !!paymentHash && hasHouseWallet(),
    refetchInterval: (query) => (query.state.data ? false : 3000),
  });
}
