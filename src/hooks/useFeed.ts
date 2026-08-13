import { useEffect, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent, NRelay } from '@nostrify/nostrify';
import { isRenderableEvent } from '@/lib/eventKinds';
import { runWhenIdle } from '@/lib/idle';
import {
  feedFilter,
  feedQueryKey,
  type FeedScope,
} from '@/lib/feedQuery';
import { useLiveFeed } from './useLiveFeed';

import { useCurrentUser } from './useCurrentUser';
import { useFollows } from './useFollows';

const PAGE_SIZE = 30;

/** Drops events with timestamps relays could not have produced honestly. */
function isPlausible(event: NostrEvent) {
  return event.created_at > 0 && event.created_at < Date.now() / 1000 + 86400;
}

async function fetchPage(
  nostr: NRelay,
  input: {
    scope: FeedScope;
    authors: string[];
    until?: number;
    signal: AbortSignal;
  }
): Promise<NostrEvent[]> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(5000)]);

  const events = await nostr.query(
    [
      {
        ...feedFilter(input.scope, input.authors),
        limit: PAGE_SIZE,
        ...(input.until ? { until: input.until } : {}),
      },
    ],
    { signal }
  );

  return events
    .filter(isPlausible)
    // Empty notes would render as blank cards, so they never enter the feed
    .filter(isRenderableEvent)
    .sort((a, b) => b.created_at - a.created_at);
}

function nextPageParam(lastPage: NostrEvent[]) {
  if (lastPage.length < PAGE_SIZE) return undefined;
  // Step one second past the oldest note so it is not returned twice
  return lastPage[lastPage.length - 1].created_at - 1;
}

/** Re-exported so components keep importing the scope from the hook. */
export type { FeedScope };

/**
 * Paginated home feed. Pages walk backwards in time using the `until` filter,
 * so "load more" appends older notes instead of refetching the whole list.
 */
export function useFeed(scope: FeedScope = 'global') {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { followingList } = useFollows(user?.pubkey || '');

  const authors = useMemo(
    () => followingList.map((follow) => follow.pubkey),
    [followingList]
  );
  const enabled = scope === 'global' || authors.length > 0;

  const queryKey = useMemo(
    () => feedQueryKey(scope, user?.pubkey),
    [scope, user?.pubkey]
  );

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchPage(nostr, { scope, authors, until: pageParam, signal }),
    getNextPageParam: nextPageParam,
    enabled,
    // A safety net under the live subscription below, and the only refresh
    // at all on a pool that cannot stream
    refetchInterval: 60_000,
  });

  /**
   * New notes arrive as they are published rather than on the next poll.
   *
   * They go into the cache, not into view — the "new posts" pill above the
   * timeline counts them and the reader chooses when to jump.
   */
  useLiveFeed(queryKey, enabled ? feedFilter(scope, authors) : null);

  /**
   * The other tab, fetched before it is asked for.
   *
   * Switching between Global and Following was the one place left that still
   * showed a full page of skeletons: the two are separate queries, so the
   * first visit to either had nothing cached and the reader watched it load.
   * Warming it in the background makes the switch instant, and costs one
   * query on a connection that is otherwise idle by then.
   *
   * Deliberately after the visible feed rather than alongside it. A prefetch
   * fired during the first render competes for the same relay connections as
   * the timeline somebody is actually waiting to read.
   */
  const queryClient = useQueryClient();

  useEffect(() => {
    const other: FeedScope = scope === 'global' ? 'following' : 'global';

    // Nothing to warm: a reader with no follows has no Following feed
    if (other === 'following' && (!user || !authors.length)) return;

    const idle = runWhenIdle(() => {
      void queryClient.prefetchInfiniteQuery({
        queryKey: feedQueryKey(other, user?.pubkey),
        initialPageParam: undefined as number | undefined,
        queryFn: ({ pageParam, signal }) =>
          fetchPage(nostr, {
            scope: other,
            authors,
            until: pageParam as number | undefined,
            signal,
          }),
        getNextPageParam: nextPageParam,
        // One page is all a tab switch needs; the rest loads on scroll
        pages: 1,
      });
    });

    return () => idle.cancel();
  }, [scope, user, authors, nostr, queryClient]);

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
