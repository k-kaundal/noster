import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

export function useTrending() {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['trending'],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      // Get recent posts from the last 24 hours
      const since = Math.floor(Date.now() / 1000) - (24 * 60 * 60);

      const events = await nostr.query([
        {
          kinds: [1],
          since,
          limit: 100,
        }
      ], { signal });

      // Filter out events with invalid timestamps
      const validEvents = events.filter(event =>
        event.created_at > 0 &&
        event.created_at < Date.now() / 1000 + 86400 &&
        event.content &&
        event.content.length > 10
      );

      // Count hashtags and mentions
      const hashtagCounts = new Map<string, number>();
      const mentionCounts = new Map<string, number>();
      const popularPosts = validEvents.sort((a, b) => b.created_at - a.created_at);

      // Extract hashtags and mentions
      validEvents.forEach(event => {
        // Extract hashtags from content
        const hashtags = event.content.match(/#\w+/g) || [];
        hashtags.forEach(tag => {
          const cleanTag = tag.toLowerCase();
          hashtagCounts.set(cleanTag, (hashtagCounts.get(cleanTag) || 0) + 1);
        });

        // Extract mentions from tags
        event.tags.forEach(tag => {
          if (tag[0] === 'p' && tag[1]) {
            mentionCounts.set(tag[1], (mentionCounts.get(tag[1]) || 0) + 1);
          }
        });
      });

      // Get top hashtags
      const topHashtags = Array.from(hashtagCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));

      // Get top mentioned pubkeys
      const topMentions = Array.from(mentionCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([pubkey, count]) => ({ pubkey, count }));

      return {
        popularPosts: popularPosts.slice(0, 20),
        topHashtags,
        topMentions,
      };
    },
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}