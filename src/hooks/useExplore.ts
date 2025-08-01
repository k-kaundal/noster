import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

export function useExplore() {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['explore'],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      // Get a diverse mix of content
      const [recentPosts, profiles, longFormContent] = await Promise.all([
        // Recent posts from various authors
        nostr.query([
          {
            kinds: [1],
            limit: 30,
          }
        ], { signal }),

        // Recent profile updates
        nostr.query([
          {
            kinds: [0],
            limit: 20,
          }
        ], { signal }),

        // Long-form content (articles)
        nostr.query([
          {
            kinds: [30023],
            limit: 10,
          }
        ], { signal }),
      ]);

      // Filter out events with invalid timestamps
      const validPosts = recentPosts.filter(post =>
        post.created_at > 0 &&
        post.created_at < Date.now() / 1000 + 86400 &&
        post.content &&
        post.content.length > 5
      );

      // Get unique authors from recent posts
      const uniqueAuthors = Array.from(new Set(validPosts.map(post => post.pubkey)));

      // Shuffle and take a sample for diversity
      const shuffledPosts = validPosts
        .sort(() => Math.random() - 0.5)
        .slice(0, 20);

      // Get posts with images
      const postsWithImages = validPosts.filter(post =>
        post.content.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi)
      ).slice(0, 10);

      // Get posts with links
      const postsWithLinks = validPosts.filter(post =>
        post.content.match(/https?:\/\/[^\s]+/gi) &&
        !post.content.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi)
      ).slice(0, 10);

      return {
        recentPosts: shuffledPosts,
        profiles: profiles.slice(0, 10),
        longFormContent,
        postsWithImages,
        postsWithLinks,
        uniqueAuthors: uniqueAuthors.slice(0, 15),
      };
    },
    refetchInterval: 2 * 60 * 1000, // Refetch every 2 minutes
  });
}