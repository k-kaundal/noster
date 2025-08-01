import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';


export function useProfile(pubkey: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['profile', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      // Query for user's posts and profile metadata
      const [posts, metadata] = await Promise.all([
        nostr.query([
          {
            kinds: [1, 6, 16],
            authors: [pubkey],
            limit: 20,
          }
        ], { signal }),
        nostr.query([
          {
            kinds: [0],
            authors: [pubkey],
            limit: 1,
          }
        ], { signal })
      ]);

      return {
        posts: posts
          .filter(post => post.created_at > 0 && post.created_at < Date.now() / 1000 + 86400)
          .sort((a, b) => b.created_at - a.created_at),
        metadata: metadata[0] || null,
      };
    },
    enabled: !!pubkey,
  });
}