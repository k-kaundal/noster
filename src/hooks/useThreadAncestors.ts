import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { getThreadPosition } from '@/lib/thread';

/** How far up a chain to walk before saying "there's more above". */
const MAX_ANCESTORS = 10;

/**
 * The chain of notes above a reply, oldest first.
 *
 * Walked one level at a time rather than fetched in a single query, because
 * each parent is only discoverable from the child's tags — the ids simply are
 * not known up front. The walk is capped so a pathological chain cannot hold
 * the page hostage, and the cap is reported so the UI can say the thread
 * continues rather than implying it starts there.
 */
export function useThreadAncestors(event: NostrEvent | undefined) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['thread-ancestors', event?.id],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      const chain: NostrEvent[] = [];
      const seen = new Set<string>([event!.id]);

      let cursor = getThreadPosition(event!).parentId;

      while (cursor && chain.length < MAX_ANCESTORS) {
        // A malformed thread can reference itself into a loop
        if (seen.has(cursor)) break;
        seen.add(cursor);

        const [parent] = await nostr.query([{ ids: [cursor], limit: 1 }], {
          signal,
        });
        if (!parent) break;

        chain.push(parent);
        cursor = getThreadPosition(parent).parentId;
      }

      return {
        // Walked upwards, so reverse to read top-down
        ancestors: chain.reverse(),
        /** Whether the walk stopped at the cap rather than at the root. */
        truncated: chain.length >= MAX_ANCESTORS && !!cursor,
      };
    },
    enabled: !!event && !!getThreadPosition(event).parentId,
    staleTime: 5 * 60 * 1000,
  });

  return {
    ancestors: query.data?.ancestors ?? [],
    truncated: query.data?.truncated ?? false,
    isLoading: query.isLoading,
  };
}
