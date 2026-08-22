import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NRelay } from '@nostrify/nostrify';
import { createBatchLoader, type BatchLoader } from '@/lib/batchLoader';

/** Long enough for a slow relay, short enough not to hold a card blank. */
const TIMEOUT = 4000;

/**
 * One request for every event a screen is asking about.
 *
 * This used to be a query per component, which is fine on a note page and
 * expensive everywhere else: a timeline of reposts fetches one original per
 * row, and showing a reply's parent would have added another. Twenty rows is
 * forty round trips, each with its own timeout, against relays that are
 * perfectly happy to answer `ids: [...forty]` once.
 *
 * The same shape `useAuthor` and `useNoteStats` already use — see
 * `lib/batchLoader`. Keyed per pool so a relay switch does not serve answers
 * collected from the previous set.
 */
const loaders = new WeakMap<NRelay, BatchLoader<string, NostrEvent | null>>();

function loaderFor(nostr: NRelay): BatchLoader<string, NostrEvent | null> {
  const held = loaders.get(nostr);
  if (held) return held;

  const loader = createBatchLoader<string, NostrEvent | null>({
    fetch: async (ids) => {
      const events = await nostr.query([{ ids }], {
        signal: AbortSignal.timeout(TIMEOUT),
      });

      return new Map(events.map((event) => [event.id, event]));
    },
    /*
     * `null` rather than `undefined` for an event nobody had. They are
     * different answers — "the relays do not have this" is worth caching, and
     * `undefined` is what react-query uses for "not fetched yet".
     */
    emptyValue: () => null,
  });

  loaders.set(nostr, loader);
  return loader;
}

export function useEvent(eventId: string) {
  const { nostr } = useNostr();

  const load = useMemo(() => loaderFor(nostr), [nostr]);

  return useQuery({
    queryKey: ['event', eventId],
    queryFn: () => load.load(eventId),
    enabled: !!eventId,
    /*
     * An event is immutable, so a copy in hand is as good as a fresh one. The
     * old five-second default meant scrolling a timeline back over a repost
     * fetched the original again.
     */
    staleTime: 10 * 60 * 1000,
  });
}
