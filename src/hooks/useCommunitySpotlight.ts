import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

/**
 * Community spotlight item - featured members and posts
 */
export interface CommunitySpotlightItem {
  id: string;                    // pubkey (members) or event id (posts)
  type: 'member' | 'post';
  title?: string;
  description?: string;
  order: number;
  joinedAt?: number;            // When member joined community
}

export interface CommunitySpotlightConfig {
  items: CommunitySpotlightItem[];
  updatedAt: number;
}

/**
 * Hook to fetch community's featured members and posts
 * Uses kind 30000 addressable event with d-tag "community-spotlight:{communityId}"
 */
export function useCommunitySpotlight(communityId: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['community-spotlight', communityId],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(2000)]);

      try {
        const events = await nostr.query(
          [{ kinds: [30000], '#d': [`community-spotlight:${communityId}`] }],
          { signal }
        );

        if (!events.length) return { items: [], updatedAt: Date.now() };

        const event = events[0];
        try {
          const config = JSON.parse(event.content) as CommunitySpotlightConfig;
          return config;
        } catch {
          return { items: [], updatedAt: Date.now() };
        }
      } catch {
        return { items: [], updatedAt: Date.now() };
      }
    },
  });
}

/**
 * Hook to publish community spotlight items
 */
export function usePublishCommunitySpotlight() {
  const { nostr } = useNostr();

  return {
    publishCommunitySpotlight: async (communityId: string, items: CommunitySpotlightItem[]) => {
      const content = JSON.stringify({
        items,
        updatedAt: Math.floor(Date.now() / 1000),
      } as CommunitySpotlightConfig);

      return nostr.event({
        kind: 30000,
        content,
        tags: [['d', `community-spotlight:${communityId}`]],
      });
    },
  };
}
