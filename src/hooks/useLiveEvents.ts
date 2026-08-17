import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import {
  LIVE_EVENT_KIND,
  newestLiveEvents,
  shelveLiveEvents,
  type LiveShelves,
} from '@/lib/nip53';

/** Long enough for relays to answer with a shelf worth showing. */
const TIMEOUT = 6000;

/**
 * How far back to look.
 *
 * Streams are not notes: an activity from last year is not interesting even as
 * history, and asking without a window makes relays return whatever they hold
 * most of, which is old.
 */
const WINDOW_DAYS = 30;

const LIMIT = 300;

/**
 * Live activities, as three shelves.
 *
 * Republished by hosts as things change — a planned stream becomes live
 * becomes ended at the same address — so only the newest revision of each is
 * kept. See `lib/nip53`.
 */
export function useLiveEvents() {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['live-events'],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(TIMEOUT)]);

      const events = await nostr.query(
        [
          {
            kinds: [LIVE_EVENT_KIND],
            since: Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400,
            limit: LIMIT,
          },
        ],
        { signal }
      );

      return newestLiveEvents(events);
    },
    /*
     * A stream starting is the one thing on this page worth noticing without
     * a reload, and the answer is small enough to ask for on a timer.
     */
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const shelves = useMemo<LiveShelves>(
    () => shelveLiveEvents(query.data ?? []),
    [query.data]
  );

  return { ...shelves, isLoading: query.isLoading, isError: query.isError };
}
