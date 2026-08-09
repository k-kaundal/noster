import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * User engagement statistics
 */
export interface UserStats {
  totalNotes: number;
  totalReplies: number;
  totalLikes: number;
  totalReposts: number;
  followerCount: number;
  followingCount: number;
  articlesPublished: number;
  avgEngagementPerPost: number;
  accountAge: number;  // days
  lastActiveDate: number;  // unix timestamp
}

/**
 * Hook to calculate user stats from their events
 */
export function useUserStats(pubkey: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['user-stats', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      try {
        // Query all events from user
        const events = await nostr.query(
          [{ authors: [pubkey], limit: 500 }],
          { signal }
        );

        // Calculate stats
        const notes = events.filter((e) => e.kind === 1 && !e.tags.some(([name]) => name === 'e'));
        const replies = events.filter((e) => e.kind === 1 && e.tags.some(([name]) => name === 'e'));
        const articles = events.filter((e) => e.kind === 30023);

        const timestamps = events.map((e) => e.created_at).filter((t) => t > 0);
        const oldestTimestamp = Math.min(...timestamps);
        const accountAgeMs = Date.now() - (oldestTimestamp * 1000);
        const accountAge = Math.floor(accountAgeMs / (1000 * 60 * 60 * 24));

        const lastActiveDate = Math.max(...timestamps);

        // Stats would include engagement metrics from reactions
        // This is simplified - real implementation would query for reactions separately
        const stats: UserStats = {
          totalNotes: notes.length,
          totalReplies: replies.length,
          totalLikes: 0,  // Would be from kind 7 (reactions) with 👍 tag
          totalReposts: 0,  // Would be from kind 6 (reposts)
          followerCount: 0,  // Would be from other users' contact lists
          followingCount: 0,  // Would be from user's contact list
          articlesPublished: articles.length,
          avgEngagementPerPost: 0,
          accountAge,
          lastActiveDate,
        };

        return stats;
      } catch {
        return {
          totalNotes: 0,
          totalReplies: 0,
          totalLikes: 0,
          totalReposts: 0,
          followerCount: 0,
          followingCount: 0,
          articlesPublished: 0,
          avgEngagementPerPost: 0,
          accountAge: 0,
          lastActiveDate: 0,
        };
      }
    },
  });
}

/**
 * Calculate engagement score
 */
export function calculateUserEngagementScore(stats: UserStats): number {
  const likes = stats.totalLikes * 1;
  const replies = stats.totalReplies * 2;
  const reposts = stats.totalReposts * 3;
  const notes = stats.totalNotes * 0.5;

  const totalEngagement = likes + replies + reposts + notes;
  const avgPerDay = Math.max(1, stats.accountAge) > 0
    ? totalEngagement / Math.max(1, stats.accountAge)
    : 0;

  return Math.round(avgPerDay * 100) / 100;
}
