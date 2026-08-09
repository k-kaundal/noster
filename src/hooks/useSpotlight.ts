import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Spotlight item - can be a post, article, community, or user
 */
export interface SpotlightItem {
  id: string;          // The ID of the item (event ID, user pubkey, etc.)
  type: 'post' | 'article' | 'community' | 'user';
  title?: string;      // Display title
  description?: string; // Optional description
  order: number;       // Display order
}

export interface SpotlightConfig {
  items: SpotlightItem[];
}

/**
 * Hook to fetch a user's spotlight/featured items
 * Uses kind 30000 addressable event with d-tag "spotlight"
 */
export function useSpotlight(pubkey: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['spotlight', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(2000)]);

      try {
        const events = await nostr.query(
          [{ kinds: [30000], authors: [pubkey], '#d': ['spotlight'] }],
          { signal }
        );

        if (!events.length) return { items: [] };

        const event = events[0];
        try {
          const config = JSON.parse(event.content) as SpotlightConfig;
          return config;
        } catch {
          return { items: [] };
        }
      } catch {
        return { items: [] };
      }
    },
  });
}

/**
 * Hook to publish a user's spotlight items
 */
export function usePublishSpotlight() {
  const { nostr } = useNostr();

  return {
    publishSpotlight: async (items: SpotlightItem[]) => {
      const content = JSON.stringify({ items } as SpotlightConfig);

      return nostr.event({
        kind: 30000,
        content,
        tags: [['d', 'spotlight']],
      });
    },
  };
}
