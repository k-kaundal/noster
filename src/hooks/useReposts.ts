import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { useToast } from './useToast';
import { useNoteStats, type NoteStats } from './useNoteStats';

export function useReposts(eventId: string) {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { reposts, isLoading } = useNoteStats(eventId);

  const userRepost = reposts.find((repost) => repost.pubkey === user?.pubkey);
  const isReposted = !!userRepost;

  const repostMutation = useMutation({
    mutationFn: async ({ targetEvent }: { targetEvent: NostrEvent }) => {
      if (!user) throw new Error('User not logged in');

      if (isReposted && userRepost) {
        await createEvent({
          kind: 5,
          content: 'Unreposted',
          tags: [['e', userRepost.id]],
        });
        return;
      }

      // Kind 6 is for text notes; anything else reposts as the generic kind 16
      const repostKind = targetEvent.kind === 1 ? 6 : 16;
      const tags = [
        ['e', eventId, '', targetEvent.pubkey],
        ['p', targetEvent.pubkey],
      ];
      if (repostKind === 16) {
        tags.push(['k', targetEvent.kind.toString()]);
      }

      await createEvent({
        kind: repostKind,
        content: repostKind === 6 ? JSON.stringify(targetEvent) : '',
        tags,
      });
    },
    /** Reflect the repost immediately rather than after the relay replies. */
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

        if (isReposted) {
          return {
            ...stats,
            reposts: stats.reposts.filter(
              (repost) => repost.id !== userRepost?.id
            ),
          };
        }

        const optimistic: NostrEvent = {
          id: `optimistic-repost-${eventId}`,
          pubkey: user.pubkey,
          kind: 6,
          content: '',
          tags: [['e', eventId]],
          created_at: Math.floor(Date.now() / 1000),
          sig: '',
        };
        return { ...stats, reposts: [...stats.reposts, optimistic] };
      });

      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['note-stats', eventId], context.previous);
      }
      console.error('Repost/unrepost error:', error);
      toast({
        title: 'Error',
        description: 'Failed to update repost. Please try again.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['note-stats', eventId] });
    },
  });

  return {
    reposts,
    isReposted,
    repostCount: reposts.length,
    isLoading,
    repost: repostMutation.mutateAsync,
    isReposting: repostMutation.isPending,
  };
}
