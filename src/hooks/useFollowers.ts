import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useRelayCapabilities } from '@/hooks/useRelayCapabilities';
import { uniqueAuthors } from '@/lib/eventMerge';
import { recallSync, remember } from '@/lib/eventStore';
import { countEvents } from '@/lib/relayCount';

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
  const { countUrl } = useRelayCapabilities();
  const scope = `followers:${pubkey}`;

  /**
   * The relay's own tally, when it will give one.
   *
   * NIP-45 answers "how many" in a single frame, which is the whole reason
   * this exists: the fetch below asks for a thousand contact lists to count
   * the people who wrote them, and anyone with more followers than that was
   * being shown a number that was really the limit. A relay that implements
   * COUNT knows the answer without sending any of them.
   *
   * Kind 3 is replaceable, so a relay holds one per author and the count is a
   * count of people. A relay that has not said it implements NIP-45 is never
   * asked — `countUrl` is undefined and this query never runs.
   */
  const countQuery = useQuery({
    queryKey: ['follower-count', pubkey, countUrl],
    queryFn: ({ signal }) =>
      countEvents(countUrl!, [{ kinds: [3], '#p': [pubkey] }], { signal }),
    enabled: !!pubkey && !!countUrl,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

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

  /**
   * The larger of the two, because each can be short in a different way.
   *
   * The fetched set is capped at `FOLLOWERS_LIMIT` per relay but unions across
   * every relay ever read, so it can exceed one relay's answer. The relay's
   * own count is uncapped but covers only what that relay holds. Neither is
   * ever an overcount — a follower has to exist to be in either — so the
   * bigger number is the closer one.
   */
  const relayCount = countQuery.data?.count ?? 0;
  const followerCount = Math.max(followerPubkeys.length, relayCount);

  return {
    followers,
    followerPubkeys,
    followerCount,
    /**
     * True when the number is larger than the list of people behind it.
     *
     * Which it usually is once a relay answers COUNT: a page can show "12,400
     * followers" while holding a thousand of them, and anything rendering an
     * avatar row from `followerPubkeys` needs to know not to claim it is the
     * whole set.
     */
    hasMoreThanLoaded: followerCount > followerPubkeys.length,
    isLoading: followersQuery.isLoading,
  };
}
