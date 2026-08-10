import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useNostrPublish } from '@/hooks/useNostrPublish';

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
 * Publishes a community's featured members and posts.
 *
 * Signed, for the same reason as the profile spotlight: `nostr.event()` takes
 * a finished event and puts it on the wire verbatim, so a template handed to
 * it arrives at the relay with no `id`, `pubkey` or `sig` and is rejected.
 */
export function usePublishCommunitySpotlight() {
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return {
    publishCommunitySpotlight: async (communityId: string, items: CommunitySpotlightItem[]) => {
      const content = JSON.stringify({
        items,
        updatedAt: Math.floor(Date.now() / 1000),
      } as CommunitySpotlightConfig);

      const event = await publishEvent({
        kind: 30000,
        content,
        tags: [['d', `community-spotlight:${communityId}`]],
      });

      queryClient.invalidateQueries({
        queryKey: ['community-spotlight', communityId],
      });

      return event;
    },
  };
}
