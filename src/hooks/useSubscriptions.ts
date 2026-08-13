import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  NO_SUBSCRIPTION,
  TIER_KIND,
  buildTierTags,
  rankTiers,
  subscriptionStatus,
  tierAddress,
  type Tier,
  type TierDraft,
} from '@/lib/subscription';

/** The tiers a creator offers, cheapest first. */
export function useTiers(pubkey: string | undefined) {
  const { nostr } = useNostr();

  const query = useQuery<NostrEvent[]>({
    queryKey: ['subscription-tiers', pubkey ?? ''],
    queryFn: async ({ signal }) =>
      nostr.query(
        [{ kinds: [TIER_KIND], authors: [pubkey!], limit: 20 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) }
      ),
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
  });

  const tiers = useMemo(() => rankTiers(query.data ?? []), [query.data]);

  return { tiers, isLoading: query.isLoading };
}

/**
 * Where the signed-in reader stands on one tier.
 *
 * Read from zap receipts, not from a membership record — paying is the only
 * act that means anything here, so the payment is the subscription. That also
 * means this answer is reproducible by anybody: the creator gating something,
 * the subscriber checking their standing, and a stranger auditing either of
 * them all compute it from the same public receipts.
 */
export function useSubscription(tier: Tier | null) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const address = tier ? tierAddress(tier) : '';

  const query = useQuery<NostrEvent[]>({
    queryKey: ['subscription-payments', address, user?.pubkey ?? ''],
    queryFn: async ({ signal }) =>
      nostr.query(
        [{ kinds: [9735], '#a': [address], limit: 200 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) }
      ),
    enabled: !!tier && !!user?.pubkey,
    staleTime: 60 * 1000,
  });

  const status = useMemo(() => {
    if (!tier || !user?.pubkey) return NO_SUBSCRIPTION;

    return subscriptionStatus(query.data ?? [], {
      tier,
      subscriber: user.pubkey,
    });
  }, [query.data, tier, user?.pubkey]);

  return { status, isLoading: query.isLoading };
}

/**
 * Everyone paying for a tier, for the creator who offers it.
 *
 * The same receipts, grouped the other way round. A creator cannot be shown a
 * subscriber list from anywhere else — there is no server holding one — so
 * this is it, and it is as complete as the relays queried.
 */
export function useSubscribers(tier: Tier | null) {
  const { nostr } = useNostr();

  const address = tier ? tierAddress(tier) : '';

  const query = useQuery<NostrEvent[]>({
    queryKey: ['subscription-payments', address, ''],
    queryFn: async ({ signal }) =>
      nostr.query(
        [{ kinds: [9735], '#a': [address], limit: 500 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }
      ),
    enabled: !!tier,
    staleTime: 60 * 1000,
  });

  const subscribers = useMemo(() => {
    if (!tier) return [];

    const payers = new Set<string>();
    for (const receipt of query.data ?? []) {
      const description = receipt.tags.find(([name]) => name === 'description')?.[1];
      if (!description) continue;

      try {
        const request = JSON.parse(description) as { pubkey?: string };
        if (request.pubkey) payers.add(request.pubkey);
      } catch {
        // A receipt whose request will not parse names nobody
      }
    }

    /*
     * Status per payer, so a lapsed supporter is not counted as a current
     * one. Computed rather than assumed: somebody who paid once a year ago
     * is in this list and is not a subscriber today.
     */
    return [...payers]
      .map((pubkey) => ({
        pubkey,
        status: subscriptionStatus(query.data ?? [], {
          tier,
          subscriber: pubkey,
        }),
      }))
      .sort((a, b) => b.status.totalSats - a.status.totalSats);
  }, [query.data, tier]);

  const active = subscribers.filter((entry) => entry.status.state === 'active');

  return { subscribers, active, isLoading: query.isLoading };
}

/** Publishing a tier, or replacing one. */
export function usePublishTier() {
  const { mutateAsync: createEvent } = useNostrPublish();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (draft: TierDraft) => {
      if (!user) throw new Error('Log in first');
      if (!draft.slug.trim()) throw new Error('A tier needs an identifier');
      if (!Number.isInteger(draft.amount) || draft.amount <= 0) {
        throw new Error('A tier needs a whole number of sats');
      }

      return createEvent({
        kind: TIER_KIND,
        content: draft.description,
        tags: buildTierTags(draft),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['subscription-tiers', user?.pubkey ?? ''],
      });
      toast({ title: 'Tier published' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not publish that tier',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Withdrawing a tier.
 *
 * A deletion request, which relays honour at their discretion — and which
 * changes nothing about periods already paid for. Somebody who bought a month
 * keeps that month; what stops is anybody starting a new one.
 */
export function useRetireTier() {
  const { mutateAsync: createEvent } = useNostrPublish();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tier: Tier) => {
      if (!user) throw new Error('Log in first');

      return createEvent({
        kind: 5,
        content: 'Tier withdrawn',
        tags: [
          ['e', tier.event.id],
          ['a', tierAddress(tier)],
          ['k', String(TIER_KIND)],
        ],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['subscription-tiers', user?.pubkey ?? ''],
      });
      toast({
        title: 'Tier withdrawn',
        description: 'Periods already paid for still run to their end.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not withdraw that tier',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
