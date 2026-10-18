import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { liveChatFilter } from '@/lib/nip53';

/**
 * The chat for one live stream.
 *
 * Kind 1311 messages addressed to the stream's `a` tag, oldest first so the
 * conversation reads top-to-bottom. A stream chat is small enough that a
 * relay can answer the whole thing in one filter.
 */
export function useLiveChat(address: string) {
  const { nostr } = useNostr();

  const query = useQuery<NostrEvent[]>({
    queryKey: ['live-chat', address],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);

      const events = await nostr.query([liveChatFilter(address)], { signal });

      return events.sort((a, b) => a.created_at - b.created_at);
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  return {
    messages: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
