import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { useToast } from './useToast';
import { useNoteStats, type NoteStats } from './useNoteStats';
import { useAppContext } from './useAppContext';
import {
  DELETION_KIND,
  REACTION_KIND,
  buildReactionTags,
  buildUnreactTags,
  groupReactions,
  isLike,
} from '@/lib/reactions';

export function useReactions(eventId: string) {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { config } = useAppContext();

  /**
   * Where the target can be found, as far as we know.
   *
   * NIP-25 asks for a hint and we do not record which relay each event
   * arrived on, so this is the relay we are reading from — which is where it
   * came from in the ordinary case. A hint is advisory, and a good guess
   * beats the empty string that was there before.
   */
  const hint = config.relayUrl;

  // Counts come from the batched stats query shared by every visible note
  const { reactions, isLoading } = useNoteStats(eventId);

  const userReaction = reactions.find(
    (reaction) => reaction.pubkey === user?.pubkey && isLike(reaction)
  );
  const isLiked = !!userReaction;
  const likeCount = reactions.filter(isLike).length;

  // One entry per distinct emoji, for the reaction chips under a note
  const groups = useMemo(
    () => groupReactions(reactions, user?.pubkey),
    [reactions, user?.pubkey]
  );

  /** Any reaction the user has left, of whatever emoji. */
  const ownReactions = useMemo(
    () => reactions.filter((reaction) => reaction.pubkey === user?.pubkey),
    [reactions, user?.pubkey]
  );

  const likeMutation = useMutation({
    mutationFn: async ({ targetEvent }: { targetEvent: NostrEvent }) => {
      if (!user) throw new Error('User not logged in');

      if (isLiked && userReaction) {
        await createEvent({
          kind: DELETION_KIND,
          content: 'Unliked',
          tags: buildUnreactTags(userReaction.id),
        });
      } else {
        await createEvent({
          kind: REACTION_KIND,
          content: '+',
          tags: buildReactionTags(targetEvent, { relay: hint }),
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

  /**
   * Reacts with an arbitrary emoji, or withdraws that reaction if it is
   * already yours. Custom emoji carry a NIP-30 tag naming the image, without
   * which other clients render the bare `:shortcode:` text.
   */
  const reactMutation = useMutation({
    mutationFn: async ({
      targetEvent,
      emoji,
      shortcode,
      url,
    }: {
      targetEvent: NostrEvent;
      emoji: string;
      shortcode?: string;
      url?: string;
    }) => {
      if (!user) throw new Error('User not logged in');

      const content = shortcode ? `:${shortcode}:` : emoji;
      const existing = ownReactions.find(
        (reaction) => reaction.content.trim() === content
      );

      if (existing) {
        await createEvent({
          kind: DELETION_KIND,
          content: 'Reaction withdrawn',
          tags: buildUnreactTags(existing.id),
        });
        return;
      }

      await createEvent({
        kind: REACTION_KIND,
        content,
        tags: buildReactionTags(targetEvent, {
          relay: hint,
          emoji: shortcode && url ? { shortcode, url } : undefined,
        }),
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Reaction failed',
        description: error.message || 'Unknown error',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['note-stats', eventId] });
    },
  });

  return {
    reactions,
    groups,
    isLiked,
    likeCount,
    isLoading,
    like: likeMutation.mutateAsync,
    isLiking: likeMutation.isPending,
    react: reactMutation.mutateAsync,
    isReacting: reactMutation.isPending,
  };
}
