import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { useToast } from './useToast';

export function useReposts(eventId: string) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query reposts for this event
  const repostsQuery = useQuery({
    queryKey: ['reposts', eventId],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(1500)]);
      const events = await nostr.query([{
        kinds: [6, 16], // Repost and Generic Repost events
        '#e': [eventId],
        limit: 500,
      }], { signal });
      
      return events;
    },
    enabled: !!eventId,
  });

  // Check if current user has reposted this event
  const userRepost = repostsQuery.data?.find(
    (repost) => repost.pubkey === user?.pubkey
  );

  const isReposted = !!userRepost;
  const repostCount = repostsQuery.data?.length || 0;

  // Repost/unrepost mutation
  const repostMutation = useMutation({
    mutationFn: async ({ targetEvent }: { targetEvent: NostrEvent }) => {
      if (!user) {
        throw new Error('User not logged in');
      }

      if (isReposted && userRepost) {
        // Unrepost: delete the repost event
        await createEvent({
          kind: 5, // Event deletion request
          content: 'Unreposted',
          tags: [
            ['e', userRepost.id],
          ],
        });
      } else {
        // Repost: create a repost event
        const repostKind = targetEvent.kind === 1 ? 6 : 16; // Use kind 6 for text notes, kind 16 for other events
        
        const tags = [
          ['e', eventId, '', targetEvent.pubkey],
          ['p', targetEvent.pubkey],
        ];

        // Add k tag for generic reposts (kind 16)
        if (repostKind === 16) {
          tags.push(['k', targetEvent.kind.toString()]);
        }

        await createEvent({
          kind: repostKind,
          content: repostKind === 6 ? JSON.stringify(targetEvent) : '', // Include original event for kind 6, empty for kind 16
          tags,
        });
      }
    },
    onSuccess: () => {
      // Invalidate reposts query to refetch
      queryClient.invalidateQueries({ queryKey: ['reposts', eventId] });
      
      toast({
        title: isReposted ? 'Unreposted' : 'Reposted',
        description: isReposted ? 'Removed your repost' : 'Added your repost',
      });
    },
    onError: (error) => {
      console.error('Repost/unrepost error:', error);
      toast({
        title: 'Error',
        description: 'Failed to update repost. Please try again.',
        variant: 'destructive',
      });
    },
  });

  return {
    reposts: repostsQuery.data || [],
    isReposted,
    repostCount,
    isLoading: repostsQuery.isLoading,
    repost: repostMutation.mutateAsync,
    isReposting: repostMutation.isPending,
  };
}