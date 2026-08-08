import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useWallet } from '@/hooks/useWallet';
import { useNWC } from '@/hooks/useNWCContext';
import { formatSats } from '@/lib/zap';

export type PayMethod = 'nostrfeed' | 'nwc' | 'webln' | 'manual';

export interface PayOption {
  /**
   * Identifies this wallet, not just its kind.
   *
   * Someone can have several NWC wallets connected — a spending one and a
   * savings one is the common pair — and `method` alone cannot tell them
   * apart, so choosing one would silently pay from whichever was marked
   * active.
   */
  id: string;
  method: PayMethod;
  label: string;
  /** Balance or alias, shown under the label. */
  detail?: string;
  /** Why this option can't be used right now, if it can't. */
  unavailable?: string;
}

export const MANUAL_OPTION: PayOption = {
  id: 'manual',
  method: 'manual',
  label: 'Pay from another wallet',
  detail: 'Scan or copy the invoice',
};

/**
 * Pays a bolt11 invoice with whatever wallet the person actually has.
 *
 * Nobody should have to move to our custodial wallet to pay for something
 * here. Plenty of people arrive with Alby, one or more NWC connections, or a
 * phone wallet, and forcing a migration would lose most of them — so every one
 * of those is a first-class way to pay, and "copy the invoice" always works
 * even when none of them are present.
 */
export function usePayAnyWallet() {
  const { wallet, balanceSats, payInvoice } = useLnbitsWallet();
  const { hasWebLN, webln } = useWallet();
  const { connections, activeConnection, connectionInfo, sendPayment } =
    useNWC();

  const options = useMemo<PayOption[]>(() => {
    const list: PayOption[] = [];

    if (wallet) {
      list.push({
        id: 'nostrfeed',
        method: 'nostrfeed',
        label: 'NostrFeed wallet',
        detail: `${formatSats(balanceSats)} sats`,
      });
    }

    // Every connection, not only the active one
    for (const connection of connections) {
      list.push({
        id: `nwc:${connection.connectionString}`,
        method: 'nwc',
        label:
          connectionInfo[connection.connectionString]?.alias ||
          connection.alias ||
          'Connected wallet',
        detail:
          connection.connectionString === activeConnection
            ? 'Nostr Wallet Connect · default'
            : 'Nostr Wallet Connect',
      });
    }

    if (hasWebLN) {
      list.push({
        id: 'webln',
        method: 'webln',
        label: 'Browser extension',
        detail: 'Alby or similar',
      });
    }

    // Always last, always possible — a QR or a copied invoice needs nothing
    list.push(MANUAL_OPTION);

    return list;
  }, [
    wallet,
    balanceSats,
    connections,
    connectionInfo,
    activeConnection,
    hasWebLN,
  ]);

  /**
   * The wallet to offer first.
   *
   * The NostrFeed wallet when it can cover the payment, since it is one tap
   * with no approval prompt. When it cannot, the next real wallet rather than
   * a button that fails on press.
   */
  const preferredFor = useMemo(
    () => (amountSats: number) => {
      const affordable = options.find((option) => {
        if (option.method === 'manual') return false;
        if (option.method !== 'nostrfeed') return true;
        return balanceSats >= amountSats;
      });

      return affordable ?? MANUAL_OPTION;
    },
    [options, balanceSats]
  );

  const pay = useMutation({
    mutationFn: async ({
      bolt11,
      optionId,
      amountSats,
    }: {
      bolt11: string;
      optionId: string;
      amountSats?: number;
    }) => {
      const option = options.find((entry) => entry.id === optionId);
      if (!option) throw new Error('That wallet is no longer connected');

      switch (option.method) {
        case 'nostrfeed': {
          if (!wallet) throw new Error('No NostrFeed wallet connected');
          if (amountSats && amountSats > balanceSats) {
            throw new Error(
              `Not enough sats. You have ${balanceSats}, this costs ${amountSats}.`
            );
          }
          await payInvoice(bolt11);
          return;
        }

        case 'nwc': {
          const connectionString = option.id.slice('nwc:'.length);
          const connection = connections.find(
            (entry) => entry.connectionString === connectionString
          );
          if (!connection) throw new Error('That wallet is no longer connected');

          // Through the hook, which builds a client for the connection. The
          // stored connection has no client on it — reading one off it was
          // why paying by NWC failed every time
          await sendPayment(connection, bolt11);
          return;
        }

        case 'webln': {
          if (!webln) throw new Error('No browser wallet available');
          await webln.enable();
          await webln.sendPayment(bolt11);
          return;
        }

        case 'manual':
          // Nothing to do — the caller shows the invoice and the person pays
          // it elsewhere, so there is no result to wait for here
          return;
      }
    },
  });

  return {
    options,
    /** Every option that can actually pay, i.e. not "copy the invoice". */
    wallets: options.filter((option) => option.method !== 'manual'),
    preferredFor,
    pay: pay.mutateAsync,
    isPaying: pay.isPending,
    balanceSats,
    hasNostrFeedWallet: !!wallet,
  };
}
