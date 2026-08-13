import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { isRenderableEvent } from '@/lib/eventKinds';
import { createEventBatcher } from '@/lib/eventBatch';

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

    /**
     * One cache write per window instead of one per event.
     *
     * Writing each event as it arrives notifies every subscriber of this query
     * — which on a feed means re-running the mute filtering, the content
     * filters and the render for a list of up to two hundred notes. At a few
     * events a second that is invisible; on a busy global feed it is a few
     * hundred renders a second and the page stops answering the main thread.
     * The events still arrive as fast as they arrive; they are handed over in
     * groups, which is all the cache and the list ever needed.
     */
    const batcher = createEventBatcher<NostrEvent>({
      key: (event) => event.id,
      // Newest first, matching how the feed stores a page
      compare: (a, b) => b.created_at - a.created_at,
      onFlush: (events) => {
        queryClient.setQueryData<FeedPages>(
          JSON.parse(cacheKey) as unknown[],
          (current) => {
            // Nothing has been fetched yet, so there is no feed to prepend
            // to — the first page will include these notes anyway
            if (!current?.pages.length) return current;

            /**
             * Checked against every page, not just the first.
             *
             * A note already further down the timeline arriving again — a
             * relay replaying after a reconnect, a slow relay repeating what
             * a fast one already delivered — was only compared against page
             * one, so it was prepended a second time and the reader saw the
             * same note twice in one list.
             */
            const known = new Set(
              current.pages.flatMap((page) => page.map((event) => event.id))
            );

            const fresh = events.filter((event) => !known.has(event.id));
            if (!fresh.length) return current;

            const [first, ...rest] = current.pages;

            /**
             * Capped, because a busy global feed left open all day would
             * otherwise grow the first page without limit.
             *
             * The cap stops accepting rather than dropping the tail, which
             * is what it used to do. The tail of this page is the oldest
             * notes on it — the ones the reader has scrolled to and is
             * reading — and page two continues below where this page
             * originally ended, so evicting them removed notes from under
             * the reader and left a hole nothing would fill. Refusing new
             * arrivals only understates a pill; the reader loses nothing
             * they were looking at, and the next refetch catches up.
             */
            const room = MAX_LIVE_PAGE - first.length;
            if (room <= 0) return current;

            return {
              ...current,
              pages: [[...fresh.slice(0, room), ...first], ...rest],
            };
          }
        );
      },
    });

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

          batcher.push(event);
        }
      } catch {
        // An aborted subscription lands here on unmount, as does a pool that
        // gave up on every relay. Neither is worth surfacing: the feed still
        // refetches on its own.
      }
    })();

    return () => {
      controller.abort();
      // Anything still waiting is dropped rather than written into a cache
      // this component has already stopped watching
      batcher.dispose();
    };
  }, [nostr, queryClient, fingerprint, cacheKey]);
}
