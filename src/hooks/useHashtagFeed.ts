import { useMemo } from 'react';
import { useContentFilter } from '@/hooks/useContentFilter';
import { useNostr } from '@nostrify/react';
import { TIMELINE_KINDS } from '@/lib/eventKinds';
import { useInfiniteQuery } from '@tanstack/react-query';

const PAGE_SIZE = 30;

/**
 * Notes carrying a given hashtag. Relays index single-letter tags, so this
 * filters on `#t` server-side and only falls back to text matching for notes
 * that wrote the hashtag inline without tagging it.
 */
export function useHashtagFeed(tag: string) {
  const { nostr } = useNostr();
  const normalized = tag.toLowerCase();

  const query = useInfiniteQuery({
    queryKey: ['hashtag-feed', normalized],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal: querySignal }) => {
      const signal = AbortSignal.any([querySignal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [
          {
            // The same kinds as any other timeline: a poll or an article
            // tagged with this topic belongs here as much as a note does
            kinds: TIMELINE_KINDS,
            '#t': [normalized],
            limit: PAGE_SIZE,
            ...(pageParam ? { until: pageParam } : {}),
          },
        ],
        { signal }
      );

      return events
        .filter((event) => event.created_at > 0)
        .sort((a, b) => b.created_at - a.created_at);
    },
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE
        ? undefined
        : lastPage[lastPage.length - 1].created_at - 1,
    enabled: !!normalized,
  });

  const { filter } = useContentFilter();

  /*
   * Filtered here rather than inside the query, so flipping a setting
   * re-renders against notes already in hand instead of waiting for a refetch
   * that would return the same events anyway.
   */
  const posts = useMemo(
    () =>
      filter(
        query.data
          ? Array.from(
              new Map(
                query.data.pages.flat().map((event) => [event.id, event])
              ).values()
            ).sort((a, b) => b.created_at - a.created_at)
          : undefined
      ),
    [query.data, filter]
  );

  return { ...query, posts };
}
