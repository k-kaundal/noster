import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import {
  EMPTY_REPORT_INDEX,
  REPORT_KIND,
  indexReports,
  shouldBlurMedia,
  shouldWarn,
  type ReportIndex,
  type ReportSummary,
} from '@/lib/reports';

/**
 * Reports written by the people you follow.
 *
 * NIP-56's client-behavior section is the whole reason this exists: "clients
 * can use reports from friends to make moderation decisions if they choose
 * to". Friends is the operative word. Reports from the open network are a
 * signal anyone can manufacture in bulk, and counting them would hand the
 * moderation of a reader's feed to whoever runs the most accounts.
 *
 * A following list is not a trust list, and this does not pretend otherwise —
 * it is just the cheapest available bound on who can affect what a reader
 * sees, and every response built on it is reversible by a click.
 */

/**
 * How many followed accounts to ask about.
 *
 * Relays cap the size of a filter, and a couple of thousand authors in one
 * `authors` array gets the whole query rejected on many of them — which fails
 * closed in the worst way, by looking exactly like "nobody reported anything".
 * Capping keeps the query answerable; the cost is that reports from the tail
 * of a very large following list are not counted, which is the right thing to
 * lose if something has to go.
 */
const MAX_AUTHORS = 750;

/** Reports age badly as evidence, and the count only ever moves slowly. */
const STALE_TIME = 10 * 60 * 1000;

export interface FriendReports {
  index: ReportIndex;
  isLoading: boolean;
  /** Reports of an account. */
  forPubkey(pubkey: string): ReportSummary | undefined;
  /** Reports of one note. */
  forEvent(eventId: string): ReportSummary | undefined;
  /** Reports of one file, by hash. */
  forBlob(hash: string): ReportSummary | undefined;
  /**
   * Whether an account's media should come up covered, per the NIP's own
   * example of the behaviour this enables.
   */
  blursMedia(pubkey: string): boolean;
  /** Whether to show a notice about an account. */
  warns(pubkey: string): boolean;
}

export function useFriendReports(): FriendReports {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { followingList } = useFollows(user?.pubkey ?? '');

  /**
   * Sorted, so the query key is stable. A following list arrives in whatever
   * order the contact list happens to hold, and keying on an unsorted array
   * would refetch every time the same people came back rearranged.
   */
  const authors = useMemo(() => {
    return [...new Set(followingList.map((entry) => entry.pubkey))]
      .sort()
      .slice(0, MAX_AUTHORS);
  }, [followingList]);

  const query = useQuery({
    queryKey: ['friend-reports', user?.pubkey, authors.length],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      try {
        return await nostr.query(
          [{ kinds: [REPORT_KIND], authors, limit: 500 }],
          { signal }
        );
      } catch {
        /**
         * A failed lookup resolves as "no reports" rather than rejecting, and
         * this is load-bearing rather than tidiness. This hook is called from
         * every note on screen, and a rejected query holds no data to go
         * stale — so each newly mounted observer would fire the request again,
         * turning one unreachable relay into a request per post per scroll.
         *
         * Returning empty is also the honest answer: not knowing whether
         * anyone reported something is the same as having no reports to act
         * on, and the failure mode that matters is the one that shows content
         * uncovered, which is what happens either way.
         */
        return [];
      }
    },
    enabled: !!user?.pubkey && authors.length > 0,
    staleTime: STALE_TIME,
    retry: false,
  });

  const index = useMemo(() => {
    if (!query.data?.length) return EMPTY_REPORT_INDEX;
    return indexReports(query.data, { viewer: user?.pubkey });
  }, [query.data, user?.pubkey]);

  return useMemo(
    () => ({
      index,
      isLoading: query.isLoading,
      forPubkey: (pubkey: string) => index.byPubkey.get(pubkey),
      forEvent: (eventId: string) => index.byEvent.get(eventId),
      forBlob: (hash: string) => index.byBlob.get(hash.toLowerCase()),
      blursMedia: (pubkey: string) => shouldBlurMedia(index.byPubkey.get(pubkey)),
      warns: (pubkey: string) => shouldWarn(index.byPubkey.get(pubkey)),
    }),
    [index, query.isLoading]
  );
}
