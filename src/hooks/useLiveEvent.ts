import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { parseLiveEvent, type LiveEvent } from '@/lib/nip53';

/**
 * One live stream, by its address.
 *
 * The listing page asks for every stream on the relay; this is the one a
 * person followed a link to. Addressable, so relays can each hold a different
 * revision — the newest wins, same as the listing.
 */
export function useLiveEvent(pubkey?: string, identifier?: string) {
  const { nostr } = useNostr();

  const query = useQuery<LiveEvent | null>({
    queryKey: ['live-event', pubkey, identifier],
    queryFn: async (c) => {
      if (!pubkey || !identifier) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [
          {
            kinds: [30311],
            authors: [pubkey],
            '#d': [identifier],
            limit: 5,
          },
        ],
        { signal }
      );

      const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!newest) return null;

      return parseLiveEvent(newest);
    },
    enabled: !!pubkey && !!identifier,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  return {
    live: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
