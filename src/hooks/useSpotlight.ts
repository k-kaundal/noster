import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';

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
  id?: string;  // Optional ID for relay validation
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
 * Publishes a user's spotlight items.
 *
 * Goes through `useNostrPublish` so the event is signed. Handing an unsigned
 * template straight to `nostr.event()` puts it on the wire exactly as written
 * — no `id`, no `pubkey`, no `sig` — and every relay answers
 * `bad msg: JSON object key "id" not found` while the UI reports success.
 */
export function usePublishSpotlight() {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return {
    publishSpotlight: async (items: SpotlightItem[]) => {
      const config: SpotlightConfig = {
        id: 'spotlight-' + Date.now(),
        items,
      };

      const event = await publishEvent({
        kind: 30000,
        content: JSON.stringify(config),
        tags: [['d', 'spotlight']],
      });

      // The saved picks are what the page reads back; without this the reader
      // keeps showing the previous set until the cache happens to expire
      if (user) {
        queryClient.invalidateQueries({ queryKey: ['spotlight', user.pubkey] });
      }

      return event;
    },
  };
}
