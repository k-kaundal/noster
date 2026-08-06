import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { NSchema as n } from '@nostrify/nostrify';
import type { NostrEvent } from '@nostrify/nostrify';

export interface SearchResults {
  posts: NostrEvent[];
  profiles: NostrEvent[];
}

/**
 * Full-text search across notes and profiles. Both filters travel in a single
 * request so a search costs one round trip to the relay rather than two, and
 * results are re-filtered locally for relays that ignore NIP-50 `search`.
 */
export function useSearch(query: string) {
  const { nostr } = useNostr();
  const searchTerm = query.toLowerCase().trim();

  return useQuery<SearchResults>({
    queryKey: ['search', searchTerm],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr
        .query(
          [
            { kinds: [1], search: searchTerm, limit: 30 },
            { kinds: [0], search: searchTerm, limit: 30 },
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
      };
    },
    enabled: searchTerm.length >= 2,
    staleTime: 30_000,
  });
}
