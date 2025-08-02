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
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [{
          kinds: [7], // Reaction events
          '#e': [eventId],
          limit: 1000,
        }],
        { signal: AbortSignal.timeout(1500) }
      );
      return events;
    },
    enabled: !!eventId,
    staleTime: 1000 * 60, // 1 minute stale time
    refetchInterval: 1000 * 30, // Refetch every 30 seconds
    refetchOnWindowFocus: true,
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
          kind: 5, // Event deletion
          content: 'Unliked',
          tags: [['e', userReaction.id]],
        });
      } else {
        // Like: create a reaction event
        await createEvent({
          kind: 7, // Reaction
          content: '+',
          tags: [
            ['e', eventId, '', 'root'], // Use 'root' marker for clarity
            ['p', targetEvent.pubkey],
            ['k', targetEvent.kind.toString()],
          ],
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reactions', eventId] });
      queryClient.refetchQueries({ queryKey: ['reactions', eventId] }); // Force refetch
      toast({
        title: isLiked ? 'Unliked' : 'Liked',
        description: isLiked ? 'Removed your like' : 'Added your like',
      });
    },
    onError: (error) => {
      // console.error('useReactions: Like/unlike error:', error);
      toast({
        title: 'Error',
        description: `Failed to update like: ${error.message || 'Unknown error'}`,
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