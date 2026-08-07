import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  POLL_RESPONSE_KIND,
  isPollClosed,
  tallyPoll,
  type Poll,
} from '@/lib/poll';

/** Live results for a poll, plus the ability to cast a vote. */
export function usePoll(pollEvent: NostrEvent, poll: Poll) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['poll-responses', pollEvent.id],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);
      return nostr.query(
        [{ kinds: [POLL_RESPONSE_KIND], '#e': [pollEvent.id], limit: 1000 }],
        { signal }
      );
    },
    staleTime: 30 * 1000,
  });

  const tally = useMemo(
    () => tallyPoll(poll, query.data ?? [], user?.pubkey),
    [poll, query.data, user?.pubkey]
  );

  const closed = isPollClosed(poll);

  const vote = useMutation({
    mutationFn: async (optionIds: string[]) => {
      if (!user) throw new Error('You must be logged in to vote');
      if (closed) throw new Error('This poll has closed');
      if (!optionIds.length) throw new Error('Pick an option first');

      await createEvent({
        kind: POLL_RESPONSE_KIND,
        content: '',
        tags: [
          ['e', pollEvent.id],
          ...optionIds.map((id) => ['response', id]),
        ],
      });
    },
    /** Show the vote immediately; a relay round trip is slower than a tap. */
    onMutate: async (optionIds) => {
      if (!user) return;

      const key = ['poll-responses', pollEvent.id];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NostrEvent[]>(key);

      queryClient.setQueryData<NostrEvent[]>(key, (current = []) => [
        // Drop any earlier vote from this user so the tally stays one-per-head
        ...current.filter((event) => event.pubkey !== user.pubkey),
        {
          id: `optimistic-${pollEvent.id}`,
          pubkey: user.pubkey,
          kind: POLL_RESPONSE_KIND,
          content: '',
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', pollEvent.id],
            ...optionIds.map((id) => ['response', id]),
          ],
          sig: '',
        },
      ]);

      return { previous };
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['poll-responses', pollEvent.id], context.previous);
      }
      toast({
        title: 'Vote not recorded',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ['poll-responses', pollEvent.id],
      });
    },
  });

  return {
    tally,
    closed,
    hasVoted: tally.ownChoices.length > 0,
    isLoading: query.isLoading,
    vote: vote.mutateAsync,
    isVoting: vote.isPending,
  };
}
