import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { useToast } from './useToast';
import { useNoteStats, type NoteStats } from './useNoteStats';

/** A reaction counts as a "like" when it is `+` or, by convention, empty. */
function isLike(event: NostrEvent): boolean {
  return event.content === '+' || event.content === '';
}

export function useReactions(eventId: string) {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Counts come from the batched stats query shared by every visible note
  const { reactions, isLoading } = useNoteStats(eventId);

  const userReaction = reactions.find(
    (reaction) => reaction.pubkey === user?.pubkey && isLike(reaction)
  );
  const isLiked = !!userReaction;
  const likeCount = reactions.filter(isLike).length;

  const likeMutation = useMutation({
    mutationFn: async ({ targetEvent }: { targetEvent: NostrEvent }) => {
      if (!user) throw new Error('User not logged in');

      if (isLiked && userReaction) {
        await createEvent({
          kind: 5,
          content: 'Unliked',
          tags: [['e', userReaction.id]],
        });
      } else {
        await createEvent({
          kind: 7,
          content: '+',
          tags: [
            ['e', eventId, '', 'root'],
            ['p', targetEvent.pubkey],
            ['k', targetEvent.kind.toString()],
          ],
        });
      }
    },
    /**
     * Paint the new state immediately. A relay round trip is far slower than a
     * tap feels like it should be, and the snapshot is restored on failure.
     */
    onMutate: async () => {
      if (!user) return;

      const key = ['note-stats', eventId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NoteStats>(key);

      queryClient.setQueryData<NoteStats>(key, (current) => {
        const stats = current ?? {
          replies: [],
          reposts: [],
          reactions: [],
          zaps: [],
        };

        if (isLiked) {
          return {
            ...stats,
            reactions: stats.reactions.filter(
              (reaction) => reaction.id !== userReaction?.id
            ),
          };
        }

        const optimistic: NostrEvent = {
          id: `optimistic-${eventId}`,
          pubkey: user.pubkey,
          kind: 7,
          content: '+',
          tags: [['e', eventId]],
          created_at: Math.floor(Date.now() / 1000),
          sig: '',
        };
        return { ...stats, reactions: [...stats.reactions, optimistic] };
      });

      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['note-stats', eventId], context.previous);
      }
      toast({
        title: 'Error',
        description: `Failed to update like: ${error.message || 'Unknown error'}`,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['note-stats', eventId] });
    },
  });

  return {
    reactions,
    isLiked,
    likeCount,
    isLoading,
    like: likeMutation.mutateAsync,
    isLiking: likeMutation.isPending,
  };
}
