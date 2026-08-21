import { useCallback, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { NostrEvent, NRelay } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { recallSync, remember } from '@/lib/eventStore';
import {
  NO_SUBSCRIPTION,
  TIER_KIND,
  buildTierTags,
  rankTiers,
  subscriptionStatus,
  summarizeMemberships,
  tierAddress,
  tierStanding,
  type Tier,
  type TierDraft,
} from '@/lib/subscription';

/** Asked of each relay. Merged after, so overlap between them costs nothing. */
const RECEIPT_LIMIT = 1000;

/**
 * A memory bound on the durable store, not a display limit.
 *
 * `mergeEvents` drops the oldest past this, which is the right end to lose:
 * current standing is decided by the newest payment on a tier, and only the
 * lifetime total gets less complete as history falls off.
 */
const RECEIPT_CAP = 5000;

/**
 * Every payment on a tier, accumulated rather than re-fetched.
 *
 * The truncation this replaces was the worst bug the feature could have. A
 * relay answering `limit: 500` on a popular tier drops the rest on the floor,
 * and which 500 come back varies by relay and by minute — so a subscriber
 * whose receipt fell outside the window was told, on a page they had paid
 * for, that they had never subscribed. It failed silently, and it failed
 * harder the more successful the tier got.
 *
 * Receipts scatter by design: a receipt is published by the *sender's*
 * lightning server to the relays the *sender's* client named, so no single
 * relay holds them all. That is the same problem the earnings page has, and it
 * gets the same answer — every read unions into a durable store keyed on the
 * receipt id, which can only add evidence. A payment that existed does not
 * stop existing because the relay holding it was slow today.
 *
 * One query per tier, shared by the subscriber's view and the creator's, so
 * the two cannot disagree about who has paid.
 */
function tierReceiptQuery(nostr: NRelay, tier: Tier | null) {
  const address = tier ? tierAddress(tier) : '';
  const scope = `tier:${address}`;

  return {
    queryKey: ['subscription-payments', address] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const received = await nostr
        .query(
          [{ kinds: [9735], '#a': [address], limit: RECEIPT_LIMIT }],
          { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) }
        )
        .catch((error: unknown) => {
          // A failed read is not the same as nobody having paid
          if (recallSync(scope).length) return null;
          throw error;
        });

      return received === null
        ? recallSync(scope)
        : await remember(scope, received, RECEIPT_CAP);
    },
    enabled: !!tier,
    staleTime: 60 * 1000,

    /** Paints what is already known before the relays are asked. */
    initialData: () => {
      const held = address ? recallSync(scope) : [];
      return held.length ? held : undefined;
    },
    initialDataUpdatedAt: 0,
  };
}

function useTierReceipts(tier: Tier | null) {
  const { nostr } = useNostr();
  return useQuery<NostrEvent[]>(tierReceiptQuery(nostr, tier));
}

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
  const { user } = useCurrentUser();

  const query = useTierReceipts(tier);

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
  const query = useTierReceipts(tier);

  /*
   * One pass, from receipts that have already been validated once. The old
   * version read payers out of the raw `description` tags and then called
   * `subscriptionStatus` per payer — which re-validated every receipt on the
   * tier once per person, and counted anybody whose request happened to parse,
   * validated or not.
   */
  const standing = useMemo(
    () => (tier ? tierStanding(tier, query.data ?? []) : null),
    [query.data, tier]
  );

  return {
    standing,
    subscribers: standing?.members ?? [],
    active: standing?.active ?? [],
    isLoading: query.isLoading,
  };
}

/**
 * The creator's whole catalogue: every tier, everyone on it, and what it earns.
 *
 * The tiers are fetched once and each one's receipts separately, because a
 * receipt names the tier it paid for and nothing else — there is no query that
 * returns "payments for any of my tiers" already grouped. Combining them into
 * one filter would save a round trip and then cost a pass to split them apart
 * again, with no way to tell an empty tier from a slow one.
 */
export function useMemberships() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { tiers, isLoading: loadingTiers } = useTiers(user?.pubkey);

  /*
   * Combined here rather than in a `useMemo` over the results, because
   * `useQueries` hands back a fresh array of fresh objects on every render —
   * so a memo depending on it would recompute every standing on every
   * unrelated render, and each recomputation verifies a signature per receipt.
   * `combine` is the one place TanStack applies structural sharing, so this
   * re-runs when the receipts actually change and not otherwise.
   */
  const combine = useCallback(
    (results: UseQueryResult<NostrEvent[]>[]) => {
      const standings = tiers.map((tier, index) =>
        tierStanding(tier, results[index]?.data ?? [])
      );

      return {
        standings,
        summary: summarizeMemberships(standings),
        isPending: results.some((result) => result.isLoading),
      };
    },
    [tiers]
  );

  const combined = useQueries({
    queries: tiers.map((tier) => tierReceiptQuery(nostr, tier)),
    combine,
  });

  return {
    standings: combined.standings,
    summary: combined.summary,
    isLoading: loadingTiers || combined.isPending,
  };
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
