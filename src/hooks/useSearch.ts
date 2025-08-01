import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

export function useSearch(query: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['search', query],
    queryFn: async (c) => {
      if (!query || query.trim().length < 2) {
        return { posts: [], profiles: [] };
      }

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const searchTerm = query.toLowerCase().trim();
      
      // Search for posts containing the query
      const posts = await nostr.query([
        {
          kinds: [1],
          search: searchTerm,
          limit: 20,
        }
      ], { signal }).catch(() => []);

      // Search for profiles
      const profiles = await nostr.query([
        {
          kinds: [0],
          limit: 10,
        }
      ], { signal }).catch(() => []);

      // Filter posts by content
      const filteredPosts = posts.filter(post => 
        post.content.toLowerCase().includes(searchTerm) &&
        post.created_at > 0 && 
        post.created_at < Date.now() / 1000 + 86400
      );

      // Filter profiles by metadata
      const filteredProfiles = profiles.filter(profile => {
        try {
          const metadata = JSON.parse(profile.content);
          return (
            metadata.name?.toLowerCase().includes(searchTerm) ||
            metadata.display_name?.toLowerCase().includes(searchTerm) ||
            metadata.about?.toLowerCase().includes(searchTerm) ||
            metadata.nip05?.toLowerCase().includes(searchTerm)
          );
        } catch {
          return false;
        }
      });

      return {
        posts: filteredPosts.slice(0, 20),
        profiles: filteredProfiles.slice(0, 10),
      };
    },
    enabled: query.trim().length >= 2,
  });
}