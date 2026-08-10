import { useState, useMemo, useEffect, useCallback } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useAppContext } from '@/hooks/useAppContext';
import { useToast } from '@/hooks/useToast';
import { nip57 } from 'nostr-tools';
import type { Event } from 'nostr-tools';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { readRelays } from '@/lib/relay';
import { describeSignerError } from '@/lib/signerErrors';
import { clearSignerFailure, recordSignerFailure } from '@/lib/signerStatus';
import {
  fetchInvoice,
  fetchPayMetadata,
  readLnurlError,
  validateAmount,
} from '@/lib/lnurlPay';
import {
  addressPointerFor,
  buildZapRequest,
  describeZapTarget,
  lightningAddressUrl,
  zapCallbackUrl,
} from '@/lib/zapRequest';

/** An invoice waiting to be paid, and what paying it will produce. */
export interface ZapInvoice {
  bolt11: string;
  amountSats: number;
  /**
   * Whether the recipient's server publishes a NIP-57 receipt. Without one the
   * money arrives but the zap appears nowhere, which is worth saying out loud.
   */
  publishesReceipt: boolean;
}

export function useZaps(target: Event | Event[], onZapSuccess?: () => void) {
  const { nostr } = useNostr();
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const queryClient = useQueryClient();

  const actualTarget = Array.isArray(target) ? (target.length > 0 ? target[0] : null) : target;

  const author = useAuthor(actualTarget?.pubkey);
  const [isZapping, setIsZapping] = useState(false);
  const [invoice, setInvoice] = useState<string | null>(null);

  const defaultRelays = [
    'wss://relay.primal.net',
    'wss://relay.damus.io',
    'wss://nostr.wine',
  ];

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setIsZapping(false);
      setInvoice(null);
    };
  }, []);

  // Poll for zap receipt when invoice is generated
  useEffect(() => {
    if (!invoice || !actualTarget) return;

    const POLL_INTERVAL = 5000; // Poll every 5 seconds
    const TIMEOUT = 300000; // Stop polling after 5 minutes

    const pollForZapReceipt = async () => {
      try {
        const signal = AbortSignal.timeout(5000);
        const events = await nostr.query(
          [{ kinds: [9735], '#e': [actualTarget.id], since: Math.floor(Date.now() / 1000) - 60 }],
          { signal }
        );
        if (events.length > 0) {
          const latestZap = events.find(zap => zap.tags.some(tag => tag[0] === 'bolt11' && tag[1] === invoice));
          if (latestZap) {
            setInvoice(null);
            setIsZapping(false);
            toast({
              title: 'Zap successful!',
              description: `Your ${nip57.getSatoshisAmountFromBolt11(invoice)} sat zap was received!`,
            });
            queryClient.invalidateQueries({ queryKey: ['zaps', actualTarget.id], exact: true });
            queryClient.refetchQueries({ queryKey: ['zaps', actualTarget.id], exact: true });
            onZapSuccess?.();
            return true;
          }
        }
        return false;
      } catch (error) {
        console.error('Error polling zap receipt:', error);
        return false;
      }
    };

    const pollIntervalId = setInterval(async () => {
      const paymentDetected = await pollForZapReceipt();
      if (paymentDetected) {
        clearInterval(pollIntervalId);
        clearTimeout(timeoutId);
      }
    }, POLL_INTERVAL);

    const timeoutId = setTimeout(() => {
      clearInterval(pollIntervalId);
      if (invoice) {
        toast({
          title: 'Zap timeout',
          description: 'No payment detected within 5 minutes. Please try again.',
          variant: 'destructive',
        });
        setInvoice(null);
        setIsZapping(false);
      }
    }, TIMEOUT);

    return () => {
      clearInterval(pollIntervalId);
      clearTimeout(timeoutId);
    };
  }, [invoice, actualTarget, nostr, queryClient, toast, onZapSuccess]);

  const { data: zapEvents, ...query } = useQuery<NostrEvent[], Error>({
    queryKey: ['zaps', actualTarget?.id],
    staleTime: 30000,
    refetchInterval: (query) => (query.getObserversCount() > 0 ? 60000 : false),
    queryFn: async (c) => {
      if (!actualTarget) return [];
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      if (actualTarget.kind >= 30000 && actualTarget.kind < 40000) {
        const identifier = actualTarget.tags.find((t) => t[0] === 'd')?.[1] || '';
        const events = await nostr.query(
          [{ kinds: [9735], '#a': [`${actualTarget.kind}:${actualTarget.pubkey}:${identifier}`] }],
          { signal }
        );
        return events;
      } else {
        const events = await nostr.query([{ kinds: [9735], '#e': [actualTarget.id] }], { signal });
        return events;
      }
    },
    enabled: !!actualTarget?.id,
  });

  const { zapCount, totalSats, zaps } = useMemo(() => {
    if (!zapEvents || !Array.isArray(zapEvents) || !actualTarget) return { zapCount: 0, totalSats: 0, zaps: [] };
    let count = 0;
    let sats = 0;
    zapEvents.forEach(zap => {
      count++;
      const amountTag = zap.tags.find(([name]) => name === 'amount')?.[1];
      if (amountTag) {
        const millisats = parseInt(amountTag);
        sats += Math.floor(millisats / 1000);
        return;
      }
      const bolt11Tag = zap.tags.find(([name]) => name === 'bolt11')?.[1];
      if (bolt11Tag) {
        try {
          const invoiceSats = nip57.getSatoshisAmountFromBolt11(bolt11Tag);
          sats += invoiceSats;
          return;
        } catch (error) {
          console.warn('Failed to parse bolt11 amount:', error);
        }
      }
      const descriptionTag = zap.tags.find(([name]) => name === 'description')?.[1];
      if (descriptionTag) {
        try {
          const zapRequest = JSON.parse(descriptionTag);
          const requestAmountTag = zapRequest.tags?.find(([name]) => name === 'amount')?.[1];
          if (requestAmountTag) {
            const millisats = parseInt(requestAmountTag);
            sats += Math.floor(millisats / 1000);
            return;
          }
        } catch (error) {
          console.warn('Failed to parse description JSON:', error);
        }
      }
      console.warn('Could not extract amount from zap receipt:', zap.id);
    });
    return { zapCount: count, totalSats: sats, zaps: zapEvents };
  }, [zapEvents, actualTarget]);

  /**
   * Turns an amount into an invoice the caller can pay with any wallet.
   *
   * The two LNURL steps and the NIP-57 request are done here; paying is not.
   * The library that used to do all three insisted on `window.webln`, which
   * made a browser extension the only way to zap anything — the custodial
   * wallet this app hands out and any connected NWC wallet were both ignored,
   * and the failure read as "no wallet available" rather than "install Alby".
   */
  const requestInvoice = async (
    amount: number,
    comment: string
  ): Promise<ZapInvoice | null> => {
    if (amount <= 0) return null;

    if (!user) {
      toast({
        title: 'Log in to zap',
        description: 'A zap is signed by you, so it needs your key.',
        variant: 'destructive',
      });
      return null;
    }

    if (!actualTarget) return null;

    const metadata = author.data?.metadata;
    if (!metadata) {
      toast({
        title: "Couldn't read their profile",
        description: 'Try again in a moment.',
        variant: 'destructive',
      });
      return null;
    }

    const problem = describeZapTarget(metadata);
    if (problem) {
      toast({ title: "Can't zap this one", description: problem, variant: 'destructive' });
      return null;
    }

    setIsZapping(true);

    try {
      /**
       * An `lud16` resolves to a well-known URL with no network call; an
       * `lud06` is a bech32 LNURL that has to be decoded, which nostr-tools
       * already does. The common case stays local either way.
       */
      const endpoint = metadata.lud16
        ? lightningAddressUrl(metadata.lud16)
        : author.data?.event
          ? await nip57.getZapEndpoint(author.data.event as Event)
          : null;

      if (!endpoint) throw new Error('Their lightning address did not resolve.');

      const payMetadata = await fetchPayMetadata(
        endpoint,
        AbortSignal.timeout(10000)
      );

      const amountMsat = amount * 1000;
      const invalid = validateAmount(amount, payMetadata);
      if (invalid) throw new Error(invalid);

      const relays = [
        ...(config.relayUrl ? [config.relayUrl] : []),
        ...readRelays(config.relays),
        ...defaultRelays,
      ];

      /**
       * A server that does not advertise `allowsNostr` will take the payment
       * and publish no receipt, so the zap is real money that shows up nowhere.
       * Worth paying anyway — the author still gets it — but worth saying.
       */
      let bolt11: string;

      if (payMetadata.allowsNostr) {
        const request = buildZapRequest({
          recipientPubkey: actualTarget.pubkey,
          amountMsat,
          relays,
          comment,
          eventId: addressPointerFor(actualTarget) ? undefined : actualTarget.id,
          addressPointer: addressPointerFor(actualTarget) ?? undefined,
        });

        /**
         * The same treatment publishing gets: a zap request is a signature
         * like any other, and a dead remote signer fails here exactly as it
         * does there — with a message about aborting that explains nothing.
         */
        let signed: NostrEvent;
        try {
          signed = await user.signer.signEvent(request);
          clearSignerFailure(user.pubkey);
        } catch (error) {
          const problem = describeSignerError(error, { method: user.method });
          recordSignerFailure(user.pubkey, problem.kind);
          throw new Error(`${problem.title}. ${problem.description}`, {
            cause: error,
          });
        }

        const response = await fetch(
          zapCallbackUrl(payMetadata.callback, amountMsat, signed),
          { signal: AbortSignal.timeout(15000) }
        );
        const body = await response.json();

        const failed = readLnurlError(body);
        if (failed) throw new Error(failed);

        const returned = (body as Record<string, unknown>)?.pr;
        if (typeof returned !== 'string' || !returned) {
          throw new Error("Their server didn't return an invoice.");
        }
        bolt11 = returned;
      } else {
        bolt11 = await fetchInvoice(
          payMetadata,
          amountMsat,
          comment,
          AbortSignal.timeout(15000)
        );
      }

      setInvoice(bolt11);
      setIsZapping(false);

      return { bolt11, amountSats: amount, publishesReceipt: payMetadata.allowsNostr };
    } catch (error) {
      setIsZapping(false);
      toast({
        title: 'Could not prepare the zap',
        description: (error as Error).message,
        variant: 'destructive',
      });
      return null;
    }
  };

  /** Called once a wallet reports the invoice paid. */
  const confirmPaid = useCallback(() => {
    if (!actualTarget) return;

    setInvoice(null);
    setIsZapping(false);
    queryClient.invalidateQueries({ queryKey: ['zaps', actualTarget.id], exact: true });
    onZapSuccess?.();
  }, [actualTarget, queryClient, onZapSuccess]);

  const resetInvoice = useCallback(() => {
    setInvoice(null);
  }, []);

  return {
    zaps,
    zapCount,
    totalSats,
    ...query,
    requestInvoice,
    confirmPaid,
    isZapping,
    invoice,
    resetInvoice,
  };
}