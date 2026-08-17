import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { uniqueAuthors } from '@/lib/eventMerge';
import { recallSync, remember } from '@/lib/eventStore';

/**
 * Long enough for a slow relay to answer.
 *
 * This was 1.5 seconds, which is not enough time for a websocket to open, a
 * subscription to go out and a relay to scan its `p` tag index — so most reads
 * ended on the timeout with whatever the two fastest relays had managed. The
 * number on screen was therefore a measure of network luck.
 */
const FOLLOWERS_TIMEOUT = 6000;

/** Asked of each relay. Merged and deduplicated after, so overlap is free. */
const FOLLOWERS_LIMIT = 1000;

/** Contact lists are large; this is a memory bound, not a display limit. */
const FOLLOWERS_CAP = 3000;

export function useFollowers(pubkey: string) {
  const { nostr } = useNostr();
  const scope = `followers:${pubkey}`;

  const followersQuery = useQuery({
    queryKey: ['followers', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([
        c.signal,
        AbortSignal.timeout(FOLLOWERS_TIMEOUT),
      ]);

      const events = await nostr
        .query([{ kinds: [3], '#p': [pubkey], limit: FOLLOWERS_LIMIT }], {
          signal,
        })
        .catch((error: unknown) => {
          /**
           * A failed read is not the same as no followers.
           *
           * If anything is already known, that is a better answer than zero
           * and is what gets shown. Only when there is nothing at all does the
           * failure surface, because then an empty state and an error state
           * really are different things and the reader should see which.
           */
          if (recallSync(scope).length) return null;
          throw error;
        });

      if (events === null) return recallSync(scope);

      /**
       * Relays index every single-letter tag together, so `#p` can match an
       * event that mentions this key for some other reason — a report, a
       * relay hint. Only a `p` tag makes someone a follower.
       */
      const tagged = events.filter((event) =>
        event.tags.some(([name, value]) => name === 'p' && value === pubkey)
      );

      return remember(scope, tagged, FOLLOWERS_CAP);
    },
    enabled: !!pubkey,

    /**
     * Paints the last known set before the network is asked.
     *
     * `initialDataUpdatedAt: 0` marks it as arbitrarily old, so this shows
     * immediately *and* refetches immediately — the point is to remove the
     * flash of "0 followers", not to serve a stale number.
     */
    initialData: () => {
      const held = pubkey ? recallSync(scope) : [];
      return held.length ? held : undefined;
    },
    initialDataUpdatedAt: 0,
  });

  const followers: NostrEvent[] = followersQuery.data ?? [];

  /**
   * People, not events.
   *
   * A contact list is replaceable, so one follower reaches us as several
   * events with different ids — one per revision any relay still holds.
   * Counting the events counted the same person once per revision, which is
   * why the follower count could exceed the number of followers.
   */
  const followerPubkeys = uniqueAuthors(followers);

  return {
    followers,
    followerPubkeys,
    followerCount: followerPubkeys.length,
    isLoading: followersQuery.isLoading,
  };
}
