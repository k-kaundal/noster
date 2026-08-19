import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { genUserName } from '@/lib/genUserName';
import { ZAP_RECEIPT_KIND } from '@/lib/zap';
import { summarizeZaps } from '@/lib/zapSummary';
import { parseZapSplits } from '@/lib/zapSplit';
import { providerKeyForRecipients } from '@/lib/zapProviders';
import { calculateEngagementScore } from '@/lib/trendingScore';

/**
 * How many candidates get their engagement fetched, and therefore how many can
 * rank at all. Bounded because the engagement query names every one of them.
 */
const RANKED_CANDIDATES = 100;

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
  /** People who paid, which is the signal a like cannot fake. */
  zaps?: number;
  /** What they paid, in sats. */
  zapSats?: number;
  author?: string;
  timestamp: number;
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

        /**
         * Only the posts we can actually score are ranked.
         *
         * Engagement is fetched for a bounded slice, and everything past it
         * used to be scored as though nobody had touched it — so the tail of
         * the candidate list was ranked at zero regardless of how popular it
         * was, and "trending" partly meant "returned early by a relay".
         */
        const candidates = events.slice(0, RANKED_CANDIDATES);
        const eventIds = candidates.map((event) => event.id);

        /*
         * Reactions, reposts, zap receipts and the authors' profiles in one
         * request. Four round trips against a relay's rate limit for data
         * that fits in one set of filters is how a page ends up rendering
         * with half of its numbers missing.
         */
        const engagement = await nostr.query(
          [
            // Kind 6 belongs here: the old filter asked for reactions only and
            // then tested `kind === 6` on the results, so reposts — the
            // highest-weighted signal in the score — were always zero
            { kinds: [7, 6], '#e': eventIds, limit: 2000 },
            { kinds: [ZAP_RECEIPT_KIND], '#e': eventIds, limit: 1000 },
            {
              kinds: [0],
              authors: [...new Set(candidates.map((event) => event.pubkey))],
            },
          ],
          { signal }
        ).catch(() => [] as NostrEvent[]);

        /**
         * Each author's lightning address, so their receipts can be checked
         * against the server that signs them.
         *
         * Worth a query here where it is not on a feed: this is one batched
         * request for the whole page rather than one per visible post, and
         * ranking is exactly where a forged total buys something.
         */
        const addresses = new Map<string, string | undefined>();
        for (const profile of engagement.filter((event) => event.kind === 0)) {
          try {
            addresses.set(
              profile.pubkey,
              (JSON.parse(profile.content) as { lud16?: string }).lud16
            );
          } catch {
            // A profile that will not parse tells us nothing about its owner
          }
        }

        const counts = new Map<
          string,
          { likes: number; reposts: number; replies: number }
        >();
        eventIds.forEach((id) =>
          counts.set(id, { likes: 0, reposts: 0, replies: 0 })
        );

        for (const reaction of engagement) {
          if (reaction.kind !== 7 && reaction.kind !== 6) continue;

          // The last `e` tag is the event reacted to; earlier ones are thread
          // context, and reading the first attributed replies to the root
          const eTag = reaction.tags
            .filter(([name]) => name === 'e')
            .at(-1)?.[1];

          const held = eTag ? counts.get(eTag) : undefined;
          if (!held) continue;

          if (reaction.kind === 6) held.reposts++;
          else held.likes++;
        }

        const receipts = engagement.filter(
          (event) => event.kind === ZAP_RECEIPT_KIND
        );

        // Rank posts by engagement
        const ranked = candidates.map((event) => {
          const held = counts.get(event.id) ?? {
            likes: 0,
            reposts: 0,
            replies: 0,
          };
          const ageHours = (Math.floor(Date.now() / 1000) - event.created_at) / 3600;

          /**
           * Checked, not counted.
           *
           * A ranking built on unchecked receipts is a ranking anybody can buy
           * a place in for the price of publishing an event, which is nothing.
           * `summarizeZaps` applies every NIP-57 check including the provider
           * key when this author's lightning server is one we have met — see
           * `lib/zapProviders` for what happens when it is not.
           */
          const recipientPubkey = [
            event.pubkey,
            ...parseZapSplits(event).map((share) => share.pubkey),
          ];

          const zapped = summarizeZaps(receipts, {
            eventId: event.id,
            recipientPubkey,
            providerPubkey: providerKeyForRecipients(
              recipientPubkey,
              addresses.get(event.pubkey)
            ),
            /*
             * A ranking is where a forged receipt actually buys something, so
             * here an unverifiable one does not count. On a note it still does
             * — see `zapSummary`.
             */
            providerPolicy: 'require' as const,
          });

          return {
            id: event.id,
            title: event.content.substring(0, 100),
            type: 'post' as const,
            engagementScore: calculateEngagementScore({
              likes: held.likes,
              reposts: held.reposts,
              zaps: zapped.count,
              zapSats: zapped.totalSats,
              ageHours,
            }),
            likes: held.likes,
            reposts: held.reposts,
            zaps: zapped.count,
            zapSats: zapped.totalSats,
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
 * Extract hashtags from events and return sorted by frequency.
 *
 * Returns the same `TrendingItem` shape as the other trending hooks, so the
 * cards on the trending page can render every list through one component.
 */
function extractHashtagsFromEvents(events: NostrEvent[], limit: number): TrendingItem[] {
  const counts = new Map<string, number>();
  // The newest note carrying a tag stands in for how current the tag is
  const lastSeen = new Map<string, number>();

  events.forEach((event) => {
    const tags = event.tags.filter(([name]) => name === 't');
    tags.forEach(([, tag]) => {
      if (!tag) return;
      const key = tag.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
      lastSeen.set(key, Math.max(lastSeen.get(key) ?? 0, event.created_at));
    });
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({
      id: tag,
      title: tag,
      type: 'hashtag' as const,
      engagementScore: count,
      timestamp: lastSeen.get(tag) ?? 0,
    }));
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

        const metadataMap = new Map<string, NostrMetadata>();
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
            // The sidebar widget ranks by raw mention count, not the score
            topHashtags: (trendingHashtags.data ?? [])
              .slice(0, 10)
              .map((hashtag) => ({
                tag: hashtag.title,
                count: hashtag.engagementScore,
              })),
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
