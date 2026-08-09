import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { LIST_KINDS, dedupeLists, parsePeopleList } from '@/lib/lists';

const LIMIT = 60;

/**
 * People lists published to the current relays.
 *
 * Both kinds are asked for in one filter rather than two queries: a follow set
 * and a starter pack are the same thing to a reader, and splitting them would
 * spend two round trips to produce one list.
 */
export function useLists(author?: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['people-lists', author ?? 'all'],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [
          {
            kinds: LIST_KINDS,
            limit: LIMIT,
            ...(author ? { authors: [author] } : {}),
          },
        ],
        { signal }
      );

      return dedupeLists(
        events
          .map(parsePeopleList)
          .filter((list): list is NonNullable<typeof list> => list !== null)
      );
    },
    staleTime: 60 * 1000,
  });
}
