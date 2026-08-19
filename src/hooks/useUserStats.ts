import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { ZAP_RECEIPT_KIND } from '@/lib/zap';
import { summarizeZaps } from '@/lib/zapSummary';
import { providerKeyForRecipients } from '@/lib/zapProviders';

/** The lightning address out of a kind 0, when it has one that parses. */
function readLud16(profile: NostrEvent | undefined): string | undefined {
  if (!profile) return undefined;

  try {
    return (JSON.parse(profile.content) as { lud16?: string }).lud16;
  } catch {
    return undefined;
  }
}

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
  /**
   * Zaps received that survived NIP-57 checking.
   *
   * Counted rather than trusted. This is the number a creator profile puts
   * forward as a credential, so it is the number somebody has a reason to
   * inflate — and inflating it costs nothing but publishing an event unless
   * every receipt is verified. See `summarizeZaps`.
   */
  zapsReceived: number;
  /**
   * Sats received across those zaps.
   *
   * A floor, not a total: the receipts are fetched with a limit and relays
   * hold different subsets, so this is what can be seen from here rather than
   * everything that was ever paid.
   */
  satsEarned: number;
}

const EMPTY_STATS: UserStats = {
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
  zapsReceived: 0,
  satsEarned: 0,
};

/** How many receipts to ask for. Beyond this the earnings figure is a floor. */
const RECEIPT_LIMIT = 1000;

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
        /*
         * Their events and the receipts paid to them, in one request. A second
         * `nostr.query` for the zaps would be another round trip against the
         * relay's rate limit for something the protocol lets us ask for in the
         * same breath.
         */
        const all = await nostr.query(
          [
            { authors: [pubkey], limit: 500 },
            { kinds: [ZAP_RECEIPT_KIND], '#p': [pubkey], limit: RECEIPT_LIMIT },
          ],
          { signal }
        );

        const events = all.filter((event) => event.pubkey === pubkey);

        /**
         * Everything paid to them, whatever it was paid for.
         *
         * No target is named, so notes, articles and zaps on the person
         * themselves all count — which is what "earned" means on a profile.
         * Every other NIP-57 check still applies, including the provider key
         * when their lightning server is one this browser has met.
         */
        const zapped = summarizeZaps(
          all.filter((event) => event.kind === ZAP_RECEIPT_KIND),
          {
            recipientPubkey: [pubkey],
            providerPubkey: providerKeyForRecipients(
              [pubkey],
              readLud16(events.find((event) => event.kind === 0))
            ),
            /*
             * A ranking is where a forged receipt actually buys something, so
             * here an unverifiable one does not count. On a note it still does
             * — see `zapSummary`.
             */
            providerPolicy: 'require' as const,
          }
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
          zapsReceived: zapped.count,
          satsEarned: zapped.totalSats,
        };

        return stats;
      } catch {
        return EMPTY_STATS;
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
