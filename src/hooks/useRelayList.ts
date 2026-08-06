import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  fromRelayListTags,
  toRelayListTags,
  type RelayEntry,
} from '@/lib/relay';

/** NIP-65 relay list metadata. */
const RELAY_LIST_KIND = 10002;

/**
 * Reads a user's published NIP-65 relay list (kind 10002) and, for the signed-in
 * user, publishes updates to it. This is how other clients discover where to
 * find your notes, so keeping it in sync matters beyond this app.
 */
export function useRelayList(pubkey?: string) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const targetPubkey = pubkey ?? user?.pubkey;

  const query = useQuery({
    queryKey: ['relay-list', targetPubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);

      const events = await nostr.query(
        [{ kinds: [RELAY_LIST_KIND], authors: [targetPubkey as string], limit: 1 }],
        { signal }
      );

      // Replaceable kind, but relays can still return more than one
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) return { entries: [] as RelayEntry[], event: null };

      return { entries: fromRelayListTags(latest.tags), event: latest };
    },
    enabled: !!targetPubkey,
    staleTime: 5 * 60 * 1000,
  });

  const publish = useMutation({
    mutationFn: async (entries: RelayEntry[]) => {
      if (!user) throw new Error('You must be logged in to publish a relay list');

      const tags = toRelayListTags(entries);
      if (!tags.length) {
        throw new Error('Add at least one read or write relay first');
      }

      await createEvent({ kind: RELAY_LIST_KIND, content: '', tags });
    },
    onSuccess: () => {
      toast({
        title: 'Relay list published',
        description: 'Other clients can now discover where to find your notes.',
      });
      queryClient.invalidateQueries({ queryKey: ['relay-list', user?.pubkey] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to publish relay list',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    entries: query.data?.entries ?? [],
    event: query.data?.event ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    publish: publish.mutateAsync,
    isPublishing: publish.isPending,
  };
}
