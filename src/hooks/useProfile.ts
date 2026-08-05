import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

export function useProfile(pubkey: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['profile', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);

      // Notes, reposts and metadata all travel in one request
      const events = await nostr.query(
        [
          { kinds: [1, 6, 16], authors: [pubkey], limit: 60 },
          { kinds: [0], authors: [pubkey], limit: 1 },
        ],
        { signal }
      );

      const posts = events
        .filter(
          (event) =>
            event.kind !== 0 &&
            event.created_at > 0 &&
            event.created_at < Date.now() / 1000 + 86400
        )
        .sort((a, b) => b.created_at - a.created_at);

      return {
        posts,
        metadata: events.find((event) => event.kind === 0) || null,
      };
    },
    enabled: !!pubkey,
  });
}
