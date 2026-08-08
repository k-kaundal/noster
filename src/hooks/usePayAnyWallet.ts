import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useWallet } from '@/hooks/useWallet';
import { useNWC } from '@/hooks/useNWCContext';

export type PayMethod = 'nostrfeed' | 'nwc' | 'webln' | 'manual';

export interface PayOption {
  method: PayMethod;
  label: string;
  /** Why this option can't be used right now, if it can't. */
  unavailable?: string;
}

/**
 * Pays a bolt11 invoice with whatever wallet the person actually has.
 *
 * Nobody should have to move to our custodial wallet to pay for something
 * here. Plenty of people arrive with Alby, a NWC connection, or a phone
 * wallet, and forcing a migration to buy relay access would lose most of
 * them — so every one of those is a first-class way to pay, and "copy the
 * invoice" always works even when none of them are present.
 */
export function usePayAnyWallet() {
  const { wallet, balanceSats, payInvoice } = useLnbitsWallet();
  const { hasWebLN, hasNWC, webln } = useWallet();
  const { getActiveConnection } = useNWC();

  const options = useMemo<PayOption[]>(() => {
    const list: PayOption[] = [];

    if (wallet) {
      list.push({ method: 'nostrfeed', label: 'NostrFeed wallet' });
    }
    if (hasNWC) {
      list.push({ method: 'nwc', label: 'Connected wallet (NWC)' });
    }
    if (hasWebLN) {
      list.push({ method: 'webln', label: 'Browser wallet' });
    }

    // Always last, always possible — a QR or a copied invoice needs nothing
    list.push({ method: 'manual', label: 'Copy invoice' });

    return list;
  }, [wallet, hasNWC, hasWebLN]);

  /** The method to offer first, given what's available and affordable. */
  const preferred = useMemo<PayMethod>(() => {
    const first = options[0]?.method ?? 'manual';
    return first;
  }, [options]);

  const pay = useMutation({
    mutationFn: async ({
      bolt11,
      method,
      amountSats,
    }: {
      bolt11: string;
      method: PayMethod;
      amountSats?: number;
    }) => {
      switch (method) {
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
          const connection = getActiveConnection();
          if (!connection?.client) throw new Error('No wallet connected');
          await connection.client.pay(bolt11);
          return;
        }

        case 'webln': {
          if (!webln) throw new Error('No browser wallet available');
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
    preferred,
    pay: pay.mutateAsync,
    isPaying: pay.isPending,
    balanceSats,
    hasNostrFeedWallet: !!wallet,
  };
}
