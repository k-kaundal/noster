import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { hasPlayableVideo, SHORT_VIDEO_KINDS } from '@/lib/video';

const PAGE_SIZE = 20;

/**
 * Short-form vertical videos (NIP-71 kind 22, plus its addressable variant).
 * Events without a playable `imeta` source are dropped, since a reel with no
 * video is just an empty screen the reader has to swipe past.
 */
export function useReels() {
  const { nostr } = useNostr();

  const query = useInfiniteQuery({
    queryKey: ['reels'],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal: querySignal }) => {
      const signal = AbortSignal.any([querySignal, AbortSignal.timeout(6000)]);

      const events = await nostr.query(
        [
          {
            kinds: SHORT_VIDEO_KINDS,
            limit: PAGE_SIZE,
            ...(pageParam ? { until: pageParam } : {}),
          },
        ],
        { signal }
      );

      return events
        .filter((event) => event.created_at > 0 && hasPlayableVideo(event))
        .sort((a, b) => b.created_at - a.created_at);
    },
    getNextPageParam: (lastPage, allPages) => {
      // Filtering can empty a page even when more history exists, so paging
      // continues from the oldest event seen rather than the last page alone
      const seen = allPages.flat();
      if (!seen.length) return undefined;
      const oldest = seen[seen.length - 1];
      return lastPage.length === 0 && allPages.length > 3
        ? undefined
        : oldest.created_at - 1;
    },
    refetchOnWindowFocus: false,
  });

  const reels = query.data
    ? Array.from(
        new Map(query.data.pages.flat().map((event) => [event.id, event])).values()
      ).sort((a, b) => b.created_at - a.created_at)
    : undefined;

  return { ...query, reels };
}
