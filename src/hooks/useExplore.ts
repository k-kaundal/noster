import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useContentFilter } from '@/hooks/useContentFilter';

export function useExplore() {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['explore'],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      // Get a diverse mix of content
      const [recentPosts, profiles, longFormContent] = await Promise.all([
        // Recent posts from various authors. Polls included: they are posts,
        // and leaving them out is why one could be missing from every surface
        // except the home feed.
        nostr.query([
          {
            kinds: [1, 1068],
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

  const { filter } = useContentFilter();

  /*
   * Explore is where a reader is handed notes by nobody they follow, which
   * makes it the screen where an unfiltered feed does the most damage: the
   * mute list and the adult switch were both being ignored here, so the one
   * place somebody meets strangers was the one place their settings did not
   * apply.
   */
  return useMemo(() => {
    if (!query.data) return query;

    const data = query.data;

    return {
      ...query,
      data: {
        ...data,
        recentPosts: filter(data.recentPosts) ?? [],
        postsWithImages: filter(data.postsWithImages) ?? [],
        postsWithLinks: filter(data.postsWithLinks) ?? [],
        longFormContent: filter(data.longFormContent) ?? [],
      },
    };
  }, [query, filter]);
}
