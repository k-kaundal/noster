import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { NSchema as n } from '@nostrify/nostrify';
import type { NostrEvent } from '@nostrify/nostrify';

import { useRelayCapabilities } from '@/hooks/useRelayCapabilities';

export interface SearchResults {
  posts: NostrEvent[];
  profiles: NostrEvent[];
  /**
   * True when no relay behind this search has a full-text index.
   *
   * Worth saying out loud, because the results then mean something different:
   * not "these are the matches" but "these are the matches among recent
   * posts". A reader who does not know that reads an empty result as "this
   * was never said".
   */
  localOnly: boolean;
}

/**
 * Asked for when a relay has no index and everything must be filtered here.
 *
 * Thirty was the figure for both cases, which quietly made search useless on
 * any relay without NIP-50: the relay ignores the `search` field, returns the
 * thirty most recent notes it has, and the local filter throws away all but
 * the ones that happen to contain the term — reliably none. Fetching a wider
 * recent window is not real search, but it does find things.
 */
const LOCAL_LIMIT = 400;

/** With an index, the relay has already done the work. */
const INDEXED_LIMIT = 30;

/**
 * Full-text search across notes and profiles. Both filters travel in a single
 * request so a search costs one round trip to the relay rather than two, and
 * results are re-filtered locally — always, since a relay may ignore the
 * `search` field, and since even an indexed relay matches by stemming rather
 * than by substring.
 */
export function useSearch(query: string) {
  const { nostr } = useNostr();
  const { search: searchSupport } = useRelayCapabilities();
  const searchTerm = query.toLowerCase().trim();

  /*
   * Only when every relay has *said* it has no index. An unknown relay — one
   * that served no NIP-11 document, which is most of them — is left on the
   * cheap path rather than made to send four hundred notes on a guess.
   */
  const localOnly = searchSupport === 'no';
  const limit = localOnly ? LOCAL_LIMIT : INDEXED_LIMIT;

  return useQuery<SearchResults>({
    queryKey: ['search', searchTerm, localOnly],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr
        .query(
          [
            { kinds: [1], search: searchTerm, limit },
            { kinds: [0], search: searchTerm, limit },
          ],
          { signal }
        )
        .catch(() => [] as NostrEvent[]);

      const posts = events
        .filter(
          (event) =>
            event.kind === 1 &&
            event.content.toLowerCase().includes(searchTerm) &&
            event.created_at > 0 &&
            event.created_at < Date.now() / 1000 + 86400
        )
        .sort((a, b) => b.created_at - a.created_at);

      const profiles = events.filter((event) => {
        if (event.kind !== 0) return false;
        try {
          const metadata = n.json().pipe(n.metadata()).parse(event.content);
          return [
            metadata.name,
            metadata.display_name,
            metadata.about,
            metadata.nip05,
          ].some((value) => value?.toLowerCase().includes(searchTerm));
        } catch {
          return false;
        }
      });

      return {
        posts: posts.slice(0, 20),
        profiles: profiles.slice(0, 10),
        localOnly,
      };
    },
    enabled: searchTerm.length >= 2,
    staleTime: 30_000,
  });
}
