import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { genUserName } from '@/lib/genUserName';

/**
 * Trending item with engagement metrics
 */
export interface TrendingItem {
  id: string;
  title: string;
  type: 'post' | 'hashtag' | 'user' | 'community';
  engagementScore: number;      // Combined metric for trending ranking
  likes?: number;
  replies?: number;
  reposts?: number;
  impressions?: number;
  author?: string;
  timestamp: number;
}

/**
 * Calculate engagement score for trending ranking
 */
export function calculateEngagementScore(
  likes: number = 0,
  replies: number = 0,
  reposts: number = 0,
  impressions: number = 0,
  ageHours: number = 1
): number {
  // Weight recent content more heavily
  const ageWeight = Math.max(0.1, 1 - (ageHours / 168)); // Decay over 1 week

  // Engagement weights (reposts valued highest, then likes, then replies)
  const score =
    (likes * 1) +
    (replies * 2) +
    (reposts * 3) +
    (impressions * 0.1);

  return Math.round(score * ageWeight * 100) / 100;
}

/**
 * Hook to fetch trending posts with engagement metrics
 */
export function useTrendingPosts(hours: number = 24, limit: number = 20) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['trending-posts', hours, limit],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const since = Math.floor((Date.now() - hours * 3600000) / 1000);

      try {
        // Query for recent posts
        const events = await nostr.query(
          [
            {
              kinds: [1],           // Text notes
              limit: Math.max(100, limit * 3),     // Get more to rank properly
              since,
            },
          ],
          { signal }
        );

        if (events.length === 0) {
          return [];
        }

        // Fetch reactions for all posts to calculate engagement
        const eventIds = events.map(e => e.id);
        const reactions = await nostr.query(
          [
            {
              kinds: [7],           // Reactions
              '#e': eventIds.slice(0, 50), // Limit reaction queries
              limit: 1000,
            },
          ],
          { signal }
        ).catch(() => []);

        const reactionCounts = new Map<string, { likes: number; reposts: number; replies: number }>();
        eventIds.forEach(id => reactionCounts.set(id, { likes: 0, reposts: 0, replies: 0 }));

        reactions.forEach(reaction => {
          const eTag = reaction.tags.find(([name]) => name === 'e')?.[1];
          if (eTag && reactionCounts.has(eTag)) {
            const counts = reactionCounts.get(eTag)!;
            if (reaction.content === '+' || reaction.content === '👍') {
              counts.likes++;
            } else if (reaction.content === '🔁' || reaction.kind === 6) {
              counts.reposts++;
            }
          }
        });

        // Rank posts by engagement
        const ranked = events.map((event) => {
          const counts = reactionCounts.get(event.id) || { likes: 0, reposts: 0, replies: 0 };
          const ageHours = (Math.floor(Date.now() / 1000) - event.created_at) / 3600;
          const score = calculateEngagementScore(counts.likes, 0, counts.reposts, 0, ageHours);

          return {
            id: event.id,
            title: event.content.substring(0, 100),
            type: 'post' as const,
            engagementScore: score,
            likes: counts.likes,
            reposts: counts.reposts,
            author: event.pubkey,
            timestamp: event.created_at,
          };
        }).sort((a, b) => b.engagementScore - a.engagementScore);

        return ranked.slice(0, limit);
      } catch {
        return [];
      }
    },
  });
}

/**
 * Extract hashtags from events and return sorted by frequency
 */
function extractHashtagsFromEvents(events: NostrEvent[], limit: number): Array<{ tag: string; count: number }> {
  const hashtagMap = new Map<string, number>();

  events.forEach((event) => {
    const tags = event.tags.filter(([name]) => name === 't');
    tags.forEach(([, tag]) => {
      if (tag) {
        hashtagMap.set(tag.toLowerCase(), (hashtagMap.get(tag.toLowerCase()) || 0) + 1);
      }
    });
  });

  return Array.from(hashtagMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

/**
 * Hook to fetch trending hashtags from primary relay first, fallback to others
 */
export function useTrendingHashtags(hours: number = 24, limit: number = 10) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['trending-hashtags', hours, limit],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);
      const since = Math.floor((Date.now() - hours * 3600000) / 1000);

      try {
        // Query for recent posts - nostr.query already uses primary relay first
        // and falls back to other relays, so this gets the best available data
        const events = await nostr.query(
          [
            {
              kinds: [1],
              limit: 200, // Get more events for better hashtag diversity
              since,
            },
          ],
          { signal }
        );

        if (events.length === 0) {
          return [];
        }

        return extractHashtagsFromEvents(events, limit);
      } catch {
        return [];
      }
    },
  });
}

/**
 * Extract mentions (pubkeys referenced with 'p' tags) from events
 */
function extractMentionsFromEvents(events: NostrEvent[], limit: number): Array<{ pubkey: string; count: number }> {
  const mentionMap = new Map<string, number>();

  events.forEach((event) => {
    // Extract p-tags (mentions/pubkeys)
    const pTags = event.tags.filter(([name]) => name === 'p');
    pTags.forEach(([, pubkey]) => {
      if (pubkey && /^[0-9a-f]{64}$/.test(pubkey)) {
        mentionMap.set(pubkey, (mentionMap.get(pubkey) || 0) + 1);
      }
    });
  });

  return Array.from(mentionMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([pubkey, count]) => ({ pubkey, count }));
}

/**
 * Hook to fetch trending users/mentions based on frequency in recent posts
 */
export function useTrendingUsers(hours: number = 24, limit: number = 10) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['trending-users', hours, limit],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const since = Math.floor((Date.now() - hours * 3600000) / 1000);

      try {
        // Query for recent posts to extract mentions
        const events = await nostr.query(
          [
            {
              kinds: [1],
              limit: 200, // Get more events for better mention diversity
              since,
            },
          ],
          { signal }
        );

        if (events.length === 0) {
          return [];
        }

        const mentions = extractMentionsFromEvents(events, limit * 2);

        // Fetch metadata for top mentions
        const pubkeysToFetch = mentions.slice(0, limit).map(m => m.pubkey);
        const metadata = await nostr.query(
          [
            {
              kinds: [0],  // Metadata
              authors: pubkeysToFetch,
              limit: limit,
            },
          ],
          { signal }
        ).catch(() => []);

        const metadataMap = new Map<string, any>();
        metadata.forEach(event => {
          try {
            const data = JSON.parse(event.content);
            metadataMap.set(event.pubkey, data);
          } catch {
            // Invalid JSON, skip
          }
        });

        // Convert to TrendingItem format with user names
        return mentions.slice(0, limit).map(({ pubkey, count }) => {
          const userMetadata = metadataMap.get(pubkey);
          const name = userMetadata?.name || userMetadata?.display_name || genUserName(pubkey);

          return {
            id: pubkey,
            title: name,
            type: 'user' as const,
            engagementScore: count,
            author: pubkey,
            timestamp: Math.floor(Date.now() / 1000),
          };
        });
      } catch {
        return [];
      }
    },
  });
}

/**
 * Hook to fetch trending communities based on recent activity
 */
export function useTrendingCommunities(hours: number = 24, limit: number = 10) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['trending-communities', hours, limit],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const since = Math.floor((Date.now() - hours * 3600000) / 1000);

      try {
        // Query for recent posts with community tags
        const events = await nostr.query(
          [
            {
              kinds: [1],           // Posts in communities
              limit: 300,
              since,
            },
          ],
          { signal }
        );

        if (events.length === 0) {
          return [];
        }

        // Extract communities from 'a' tags (addressable event pointers)
        const communityMap = new Map<string, { name: string; count: number; pubkey: string; slug: string }>();

        events.forEach(event => {
          const aTag = event.tags.find(([name]) => name === 'a')?.[1];
          if (aTag) {
            // Format: 34550:pubkey:slug
            const [kind, pubkey, slug] = aTag.split(':');
            if (kind === '34550' && pubkey && slug) {
              const id = `${pubkey}:${slug}`;
              const current = communityMap.get(id);
              communityMap.set(id, {
                name: slug,
                count: (current?.count || 0) + 1,
                pubkey,
                slug,
              });
            }
          }
        });

        if (communityMap.size === 0) {
          return [];
        }

        // Sort by activity count
        const sorted = Array.from(communityMap.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, limit);

        // Fetch community definitions for better names
        const communityAddrs = sorted.map(c => `34550:${c.pubkey}:${c.slug}`);
        const communities = await nostr.query(
          [
            {
              kinds: [34550],  // Community definitions
              limit: limit,
            },
          ],
          { signal }
        ).catch(() => []);

        const communityNames = new Map<string, string>();
        communities.forEach(event => {
          const dTag = event.tags.find(([name]) => name === 'd')?.[1];
          const nameTag = event.tags.find(([name]) => name === 'name')?.[1];
          if (dTag && nameTag) {
            communityNames.set(`${event.pubkey}:${dTag}`, nameTag);
          }
        });

        // Build final results
        return sorted.map(community => ({
          id: `${community.pubkey}:${community.slug}`,
          title: communityNames.get(`${community.pubkey}:${community.slug}`) || community.slug,
          type: 'community' as const,
          engagementScore: community.count,
          author: community.pubkey,
          timestamp: Math.floor(Date.now() / 1000),
        }));
      } catch {
        return [];
      }
    },
  });
}

/**
 * Combined trending data hook for discovery widgets
 * Prefers primary relay data; falls back to other relays if primary is empty
 */
export function useTrending() {
  const trendingHashtags = useTrendingHashtags(24, 10);
  const trendingUsers = useTrendingUsers(24, 5);

  return {
    data:
      trendingHashtags.data?.length || trendingUsers.data?.length
        ? {
            topHashtags: (trendingHashtags.data ?? []).slice(0, 10),
            topMentions:
              (trendingUsers.data ?? []).map((user) => ({
                pubkey: user.id,
                count: Math.round(user.engagementScore),
              })).slice(0, 5),
          }
        : undefined,
    isLoading: trendingHashtags.isLoading || trendingUsers.isLoading,
    error: trendingHashtags.error || trendingUsers.error,
  };
}
