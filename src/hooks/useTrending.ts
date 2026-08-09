import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

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
 * Hook to fetch trending posts
 */
export function useTrendingPosts(hours: number = 24, limit: number = 20) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['trending-posts', hours, limit],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      const since = Math.floor((Date.now() - hours * 3600000) / 1000);

      try {
        // Query for recent posts
        const events = await nostr.query(
          [
            {
              kinds: [1],           // Text notes
              limit: limit * 2,     // Get extra to rank
              since,
            },
          ],
          { signal }
        );

        // Sort by engagement (simplified - in real app would aggregate reactions)
        return events.slice(0, limit).map((event) => ({
          id: event.id,
          title: event.content.substring(0, 100),
          type: 'post' as const,
          engagementScore: 0,       // Would be calculated from reactions
          author: event.pubkey,
          timestamp: event.created_at,
        }));
      } catch {
        return [];
      }
    },
  });
}

/**
 * Hook to fetch trending hashtags
 */
export function useTrendingHashtags(hours: number = 24, limit: number = 10) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['trending-hashtags', hours, limit],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      const since = Math.floor((Date.now() - hours * 3600000) / 1000);

      try {
        // Query for recent posts
        const events = await nostr.query(
          [
            {
              kinds: [1],
              limit: 100,
              since,
            },
          ],
          { signal }
        );

        // Extract and count hashtags
        const hashtagMap = new Map<string, number>();
        events.forEach((event) => {
          const tags = event.tags.filter(([name]) => name === 't');
          tags.forEach(([, tag]) => {
            hashtagMap.set(tag, (hashtagMap.get(tag) || 0) + 1);
          });
        });

        // Sort by frequency and return top
        return Array.from(hashtagMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([tag, count]) => ({
            id: tag,
            title: `#${tag}`,
            type: 'hashtag' as const,
            engagementScore: count * 10,
            timestamp: Math.floor(Date.now() / 1000),
          }));
      } catch {
        return [];
      }
    },
  });
}

/**
 * Hook to fetch trending users based on follower growth
 */
export function useTrendingUsers(hours: number = 24, limit: number = 10) {
  return useQuery({
    queryKey: ['trending-users', hours, limit],
    queryFn: async (c) => {
      // In a real implementation, this would track follower growth
      // For now, returns empty array - should be implemented with analytics
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(2000)]);

      try {
        // Placeholder implementation
        return [] as TrendingItem[];
      } catch {
        return [];
      }
    },
  });
}

/**
 * Hook to fetch trending communities
 */
export function useTrendingCommunities(hours: number = 24, limit: number = 10) {
  return useQuery({
    queryKey: ['trending-communities', hours, limit],
    queryFn: async (c) => {
      // In a real implementation, this would track community activity
      // For now, returns empty array - should be implemented with activity metrics
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(2000)]);

      try {
        // Placeholder implementation
        return [] as TrendingItem[];
      } catch {
        return [];
      }
    },
  });
}

/**
 * Combined trending data hook for discovery widgets
 */
export function useTrending() {
  const trendingHashtags = useTrendingHashtags(24, 10);
  const trendingUsers = useTrendingUsers(24, 5);

  return {
    data:
      trendingHashtags.data || trendingUsers.data
        ? {
            topHashtags: trendingHashtags.data ?? [],
            topMentions:
              trendingUsers.data?.map((user) => ({
                pubkey: user.id,
                count: Math.round(user.engagementScore),
              })) ?? [],
          }
        : undefined,
    isLoading: trendingHashtags.isLoading || trendingUsers.isLoading,
  };
}
