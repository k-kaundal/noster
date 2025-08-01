import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

export function useFollowers(pubkey: string) {
  const { nostr } = useNostr();

  // Query all follow lists that include this pubkey
  const followersQuery = useQuery({
    queryKey: ['followers', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(1500)]);
      const events = await nostr.query([{
        kinds: [3], // Follow list events
        '#p': [pubkey], // Events that tag this pubkey
        limit: 500,
      }], { signal });
      
      // Filter to only include events where this pubkey is actually in the p tags
      // (to avoid false positives from other tag types)
      const followers = events.filter(event => 
        event.tags.some(tag => tag[0] === 'p' && tag[1] === pubkey)
      );
      
      return followers;
    },
    enabled: !!pubkey,
  });

  const followers = followersQuery.data || [];
  const followerCount = followers.length;

  // Get unique follower pubkeys
  const followerPubkeys = [...new Set(followers.map(event => event.pubkey))];

  return {
    followers,
    followerPubkeys,
    followerCount,
    isLoading: followersQuery.isLoading,
  };
}