import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { isRenderableEvent } from '@/lib/eventKinds';

/** Newest-first pages, as `useInfiniteQuery` stores them. */
type FeedPages = InfiniteData<NostrEvent[], number | undefined>;

/** Most notes the live subscription will let the first page hold. */
const MAX_LIVE_PAGE = 200;

/**
 * The pool, as far as this file is concerned.
 *
 * `req` opens a long-lived subscription and yields relay messages as they
 * arrive. Typed structurally so a pool without it — an older version, a test
 * double — is a missing method to check for rather than a crash.
 */
type Streamer = {
  req?: (
    filters: NostrFilter[],
    opts?: { signal?: AbortSignal }
  ) => AsyncIterable<unknown[]>;
};

/**
 * Streams new notes into a feed as they are published.
 *
 * The feed used to refetch every sixty seconds, which is both too often when
 * nothing is happening and far too slow when something is: a conversation
 * moves faster than a minute, and a timeline that only updates on a timer
 * reads as a page rather than as a place.
 *
 * Notes are put into the cache but not into view — the existing "new posts"
 * pill counts them and the reader decides when to jump. Content that moves
 * under someone mid-sentence is worse than content that arrives late.
 */
export function useLiveFeed(
  queryKey: readonly unknown[],
  filter: NostrFilter | null
) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  // Serialised so a filter rebuilt each render doesn't reopen the
  // subscription — which would drop and reconnect a websocket per render
  const fingerprint = filter ? JSON.stringify(filter) : '';
  const cacheKey = JSON.stringify(queryKey);

  useEffect(() => {
    if (!fingerprint) return;

    const pool = nostr as unknown as Streamer;
    const req = pool.req;
    if (typeof req !== 'function') return;

    const controller = new AbortController();

    (async () => {
      const since = Math.floor(Date.now() / 1000);
      const live: NostrFilter = { ...JSON.parse(fingerprint), since };

      try {
        for await (const message of req.call(pool, [live], {
          signal: controller.signal,
        })) {
          if (message[0] !== 'EVENT') continue;

          const event = message[2] as NostrEvent;
          if (!event?.id || !isRenderableEvent(event)) continue;

          queryClient.setQueryData<FeedPages>(
            JSON.parse(cacheKey) as unknown[],
            (current) => {
              // Nothing has been fetched yet, so there is no feed to prepend
              // to — the first page will include this note anyway
              if (!current?.pages.length) return current;

              const [first, ...rest] = current.pages;
              if (first.some((existing) => existing.id === event.id)) {
                return current;
              }

              // Capped: a busy global feed left open all day would otherwise
              // grow the first page without limit, and everything above what
              // the reader has seen is held back rather than rendered anyway
              const grown = [event, ...first].slice(0, MAX_LIVE_PAGE);

              return { ...current, pages: [grown, ...rest] };
            }
          );
        }
      } catch {
        // An aborted subscription lands here on unmount, as does a pool that
        // gave up on every relay. Neither is worth surfacing: the feed still
        // refetches on its own.
      }
    })();

    return () => controller.abort();
  }, [nostr, queryClient, fingerprint, cacheKey]);
}
