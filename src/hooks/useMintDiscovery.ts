import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  CASHU_MINT_KIND,
  RECOMMENDATION_KIND,
  buildRecommendationTags,
  parseMintAnnouncement,
  parseRecommendation,
  rankMints,
  type MintKind,
  type RankedMint,
} from '@/lib/nip87';

/** Cap on how many follows are named in one filter, so the query stays sendable. */
const MAX_AUTHORS = 500;

/**
 * Mints the people you follow keep money at.
 *
 * Two hops, in the order NIP-87 describes: recommendations first, then the
 * announcements they point at. Deliberately not the shortcut of querying
 * kind 38172 directly — that returns every mint that published an
 * announcement, ranked by nothing, to somebody about to deposit money into
 * one. The spec's own warning about that path is the reason this one starts
 * from a follow list.
 *
 * Someone following nobody gets an empty list rather than an unfiltered one.
 * That is the honest answer: this client has no basis to suggest a custodian
 * to them, and inventing one would be worse than saying so.
 */
export function useMintDiscovery(kind: MintKind = CASHU_MINT_KIND) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { followingList } = useFollows(user?.pubkey ?? '');

  const authors = [
    ...new Set(
      [
        ...(user ? [user.pubkey] : []),
        ...followingList.map((follow) => follow.pubkey),
      ].filter(Boolean)
    ),
  ].slice(0, MAX_AUTHORS);

  return useQuery<RankedMint[]>({
    queryKey: ['mint-discovery', kind, authors.length, authors[0] ?? ''],
    queryFn: async ({ signal }) => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [
          {
            kinds: [RECOMMENDATION_KIND],
            authors,
            '#k': [String(kind)],
            limit: 200,
          },
        ],
        { signal: timeout }
      );

      const recommendations = events
        .map(parseRecommendation)
        .filter((entry): entry is NonNullable<typeof entry> => !!entry)
        .filter((entry) => entry.kind === kind);

      if (!recommendations.length) return [];

      /**
       * Fetched by `d` rather than by author. A recommendation's `a` tag names
       * a specific announcement, but the spec allows the `d` to be computed
       * when no announcement was ever seen — so asking by identifier finds the
       * mint's own event whoever published it.
       */
      const targets = [...new Set(recommendations.map((entry) => entry.target))];

      const announcementEvents = await nostr.query(
        [{ kinds: [kind], '#d': targets, limit: targets.length * 4 }],
        { signal: timeout }
      );

      /**
       * Duplicates are expected and are the point of the `a` tag: anyone can
       * publish an announcement claiming any `d`. Keeping the newest per
       * author-and-identifier leaves the impostors in the list rather than
       * silently picking one, and `rankMints` then sorts by who vouched for
       * it — an announcement nobody recommended sinks to the bottom with zero.
       */
      const announcements = announcementEvents
        .sort((a, b) => b.created_at - a.created_at)
        .map(parseMintAnnouncement)
        .filter((entry): entry is NonNullable<typeof entry> => !!entry);

      const seen = new Set<string>();
      const unique = announcements.filter((entry) => {
        const key = `${entry.event.pubkey}:${entry.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return rankMints(unique, recommendations).filter(
        (ranked) => ranked.recommenders.length > 0
      );
    },
    enabled: authors.length > 0,
    staleTime: 10 * 60_000,
  });
}

/** Publishing your own recommendation for a mint. */
export function useRecommendMint() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: {
      target: string;
      kind: MintKind;
      urls: string[];
      review?: string;
      relayHint?: string;
    }) => {
      if (!user) throw new Error('Log in first');
      if (!input.target) {
        throw new Error(
          "This mint doesn't report an identity, so there is nothing to point a recommendation at."
        );
      }

      await createEvent({
        kind: RECOMMENDATION_KIND,
        content: input.review?.trim() ?? '',
        tags: buildRecommendationTags(input),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mint-discovery'] });
      toast({
        title: 'Recommendation published',
        description:
          'People who follow you will see this mint when they look for one.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not publish that recommendation',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
