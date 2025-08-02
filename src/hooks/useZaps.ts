import { useState, useMemo, useEffect, useCallback } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useAppContext } from '@/hooks/useAppContext';
import { useToast } from '@/hooks/useToast';
import { useNWC } from '@/hooks/useNWCContext';
import type { NWCConnection } from '@/hooks/useNWC';
import { nip57 } from 'nostr-tools';
import type { Event } from 'nostr-tools';
import type { WebLNProvider } from 'webln';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

export function useZaps(
  target: Event | Event[],
  webln: WebLNProvider | null,
  _nwcConnection: NWCConnection | null,
  onZapSuccess?: () => void
) {
  const { nostr } = useNostr();
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const queryClient = useQueryClient();

  const actualTarget = Array.isArray(target) ? (target.length > 0 ? target[0] : null) : target;

  const author = useAuthor(actualTarget?.pubkey);
  const { sendPayment, getActiveConnection } = useNWC();
  const [isZapping, setIsZapping] = useState(false);
  const [invoice, setInvoice] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      setIsZapping(false);
      setInvoice(null);
    };
  }, []);

  const { data: zapEvents, ...query } = useQuery<NostrEvent[], Error>({
    queryKey: ['zaps', actualTarget?.id],
    staleTime: 30000,
    refetchInterval: (query) => (query.getObserversCount() > 0 ? 60000 : false),
    queryFn: async (c) => {
      if (!actualTarget) return [];
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      if (actualTarget.kind >= 30000 && actualTarget.kind < 40000) {
        const identifier = actualTarget.tags.find((t) => t[0] === 'd')?.[1] || '';
        const events = await nostr.query([{ kinds: [9735], '#a': [`${actualTarget.kind}:${actualTarget.pubkey}:${identifier}`] }], { signal });
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

  const zap = async (amount: number, comment: string) => {
    if (amount <= 0) return;

    setIsZapping(true);
    setInvoice(null);

    if (!user) {
      toast({ title: 'Login required', description: 'You must be logged in to send a zap.', variant: 'destructive' });
      setIsZapping(false);
      return;
    }

    if (!actualTarget) {
      toast({ title: 'Event not found', description: 'Could not find the event to zap.', variant: 'destructive' });
      setIsZapping(false);
      return;
    }

    try {
      if (!author.data || !author.data.metadata || !author.data.event) {
        toast({ title: 'Author not found', description: 'Could not find the author of this item.', variant: 'destructive' });
        setIsZapping(false);
        return;
      }

      const { lud06, lud16 } = author.data.metadata;
      if (!lud06 && !lud16) {
        toast({ title: 'Lightning address not found', description: 'The author does not have a lightning address configured.', variant: 'destructive' });
        setIsZapping(false);
        return;
      }

      const zapEndpoint = await nip57.getZapEndpoint(author.data.event);
      if (!zapEndpoint) {
        toast({ title: 'Zap endpoint not found', description: 'Could not find a zap endpoint for the author.', variant: 'destructive' });
        console.error('No zap endpoint for pubkey:', actualTarget.pubkey); // Debug
        setIsZapping(false);
        return;
      }

      const event = actualTarget.kind >= 30000 && actualTarget.kind < 40000 ? actualTarget : actualTarget.id;
      const zapAmount = amount * 1000;

      const zapRequest = nip57.makeZapRequest({
        profile: actualTarget.pubkey,
        event,
        amount: zapAmount,
        relays: [config.relayUrl],
        comment,
      });

      if (!user.signer) throw new Error('No signer available');
      const signedZapRequest = await user.signer.signEvent(zapRequest);

      const res = await fetch(`${zapEndpoint}?amount=${zapAmount}&nostr=${encodeURI(JSON.stringify(signedZapRequest))}`);
      const responseData = await res.json();

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${responseData.reason || 'Unknown error'}`);
      const newInvoice = responseData.pr;
      if (!newInvoice || typeof newInvoice !== 'string') throw new Error('Lightning service did not return a valid invoice');

      const currentNWCConnection = getActiveConnection();
      if (currentNWCConnection && currentNWCConnection.connectionString && currentNWCConnection.isConnected) {
        try {
          await sendPayment(currentNWCConnection, newInvoice);
          setIsZapping(false);
          setInvoice(null);
          toast({ title: 'Zap successful!', description: `You sent ${amount} sats via NWC to the author.` });
          queryClient.invalidateQueries({ queryKey: ['zaps'] });
          onZapSuccess?.();
          return;
        } catch (nwcError) {
          console.error('NWC payment failed:', nwcError);
          toast({ title: 'NWC payment failed', description: `${nwcError.message || 'Unknown NWC error'}. Falling back...`, variant: 'destructive' });
        }
      }

      if (webln) {
        try {
          await webln.sendPayment(newInvoice);
          setIsZapping(false);
          setInvoice(null);
          toast({ title: 'Zap successful!', description: `You sent ${amount} sats to the author.` });
          queryClient.invalidateQueries({ queryKey: ['zaps'] });
          onZapSuccess?.();
        } catch (weblnError) {
          console.error('WebLN payment failed:', weblnError);
          toast({ title: 'WebLN payment failed', description: `${weblnError.message || 'Unknown WebLN error'}. Falling back...`, variant: 'destructive' });
          setInvoice(newInvoice);
          setIsZapping(false);
        }
      } else {
        setInvoice(newInvoice);
        setIsZapping(false);
      }
    } catch (err) {
      console.error('Zap process error:', err);
      toast({ title: 'Zap failed', description: (err as Error).message, variant: 'destructive' });
      setIsZapping(false);
    }
  };

  const resetInvoice = useCallback(() => {
    setInvoice(null);
  }, []);

  return {
    zaps,
    zapCount,
    totalSats,
    ...query,
    zap,
    isZapping,
    invoice,
    setInvoice,
    resetInvoice,
  };
}