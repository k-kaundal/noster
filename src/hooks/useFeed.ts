import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';


export function useFeed() {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['feed'],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      // Query for text notes (kind 1) and reposts (kind 6, 16)
      const events = await nostr.query([
        {
          kinds: [1, 6, 16],
          limit: 50,
        }
      ], { signal });

      // Filter out events with invalid timestamps and sort by created_at descending (newest first)
      return events
        .filter(event => event.created_at > 0 && event.created_at < Date.now() / 1000 + 86400)
        .sort((a, b) => b.created_at - a.created_at);
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}