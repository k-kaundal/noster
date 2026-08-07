import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { normalizeRelayUrl } from '@/lib/relay';
import { DM_RELAY_LIST_KIND } from '@/lib/nip17';

/**
 * The user's own NIP-17 DM relay list (kind 10050).
 *
 * Without one published, other clients have nowhere to deliver private
 * messages, so conversations silently never arrive. This is the write side of
 * `useDmRelays`, which only reads other people's lists.
 */
export function useDmRelayList() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['dm-relays', user?.pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);
      const events = await nostr.query(
        [{ kinds: [DM_RELAY_LIST_KIND], authors: [user!.pubkey], limit: 1 }],
        { signal }
      );

      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      return (latest?.tags ?? [])
        .filter(([name]) => name === 'relay')
        .map(([, url]) => url)
        .filter(Boolean);
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60 * 1000,
  });

  const publish = useMutation({
    mutationFn: async (urls: string[]) => {
      if (!user) throw new Error('You must be logged in');

      const normalized = [
        ...new Set(urls.map(normalizeRelayUrl).filter(Boolean)),
      ];
      if (!normalized.length) {
        throw new Error('Choose at least one relay to receive messages on');
      }

      await createEvent({
        kind: DM_RELAY_LIST_KIND,
        content: '',
        tags: normalized.map((url) => ['relay', url]),
      });

      return normalized;
    },
    onSuccess: (urls) => {
      queryClient.setQueryData(['dm-relays', user?.pubkey], urls);
      toast({
        title: 'Message relays published',
        description: 'Others can now send you private messages.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not publish message relays',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    relays: query.data ?? [],
    isLoading: query.isLoading,
    publish: publish.mutateAsync,
    isPublishing: publish.isPending,
  };
}
