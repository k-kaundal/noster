import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { useToast } from './useToast';

export function useReactions(eventId: string) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query reactions for this event
  const reactionsQuery = useQuery({
    queryKey: ['reactions', eventId],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(1500)]);
      const events = await nostr.query([{
        kinds: [7], // Reaction events
        '#e': [eventId],
        limit: 500,
      }], { signal });
      
      return events;
    },
    enabled: !!eventId,
  });

  // Check if current user has liked this event
  const userReaction = reactionsQuery.data?.find(
    (reaction) => reaction.pubkey === user?.pubkey && (reaction.content === '+' || reaction.content === '')
  );

  const isLiked = !!userReaction;
  const likeCount = reactionsQuery.data?.filter(
    (reaction) => reaction.content === '+' || reaction.content === ''
  ).length || 0;

  // Like/unlike mutation
  const likeMutation = useMutation({
    mutationFn: async ({ targetEvent }: { targetEvent: NostrEvent }) => {
      if (!user) {
        throw new Error('User not logged in');
      }

      if (isLiked && userReaction) {
        // Unlike: delete the reaction event
        await createEvent({
          kind: 5, // Event deletion request
          content: 'Unliked',
          tags: [
            ['e', userReaction.id],
          ],
        });
      } else {
        // Like: create a reaction event
        await createEvent({
          kind: 7, // Reaction
          content: '+',
          tags: [
            ['e', eventId, '', targetEvent.pubkey],
            ['p', targetEvent.pubkey],
            ['k', targetEvent.kind.toString()],
          ],
        });
      }
    },
    onSuccess: () => {
      // Invalidate reactions query to refetch
      queryClient.invalidateQueries({ queryKey: ['reactions', eventId] });
      
      toast({
        title: isLiked ? 'Unliked' : 'Liked',
        description: isLiked ? 'Removed your like' : 'Added your like',
      });
    },
    onError: (error) => {
      console.error('Like/unlike error:', error);
      toast({
        title: 'Error',
        description: 'Failed to update like. Please try again.',
        variant: 'destructive',
      });
    },
  });

  return {
    reactions: reactionsQuery.data || [],
    isLiked,
    likeCount,
    isLoading: reactionsQuery.isLoading,
    like: likeMutation.mutateAsync,
    isLiking: likeMutation.isPending,
  };
}