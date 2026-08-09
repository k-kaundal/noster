import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { isRenderableEvent } from '@/lib/eventKinds';

import { useCurrentUser } from './useCurrentUser';
import { useFollows } from './useFollows';

export type FeedScope = 'global' | 'following';

const PAGE_SIZE = 30;

/** Drops events with timestamps relays could not have produced honestly. */
function isPlausible(event: NostrEvent) {
  return event.created_at > 0 && event.created_at < Date.now() / 1000 + 86400;
}

/**
 * Paginated home feed. Pages walk backwards in time using the `until` filter,
 * so "load more" appends older notes instead of refetching the whole list.
 */
export function useFeed(scope: FeedScope = 'global') {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { followingList } = useFollows(user?.pubkey || '');

  const authors = followingList.map((follow) => follow.pubkey);
  const enabled = scope === 'global' || authors.length > 0;

  const query = useInfiniteQuery({
    queryKey: ['feed', scope, scope === 'following' ? authors.length : 0],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal: querySignal }) => {
      const signal = AbortSignal.any([
        querySignal,
        AbortSignal.timeout(5000),
      ]);

      const events = await nostr.query(
        [
          {
            // Include text notes, reposts, polls, and articles
            // 1068 is NIP-88 polls
            // 30023 is long-form articles (NIP-23)
            kinds: [1, 6, 16, 1068, 30023],
            limit: PAGE_SIZE,
            ...(pageParam ? { until: pageParam } : {}),
            // Relays index authors, so following feeds filter server-side
            ...(scope === 'following' ? { authors: authors.slice(0, 500) } : {}),
          },
        ],
        { signal }
      );

      return events
        .filter(isPlausible)
        // Empty notes would render as blank cards, so they never enter the feed
        .filter(isRenderableEvent)
        .sort((a, b) => b.created_at - a.created_at);
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      // Step one second past the oldest note so it is not returned twice
      return lastPage[lastPage.length - 1].created_at - 1;
    },
    enabled,
    refetchInterval: 60_000,
  });

  // Relays can return overlapping pages, so identical ids are collapsed here
  const posts = query.data
    ? Array.from(
        new Map(
          query.data.pages.flat().map((event) => [event.id, event])
        ).values()
      ).sort((a, b) => b.created_at - a.created_at)
    : undefined;

  return { ...query, posts, enabled };
}
