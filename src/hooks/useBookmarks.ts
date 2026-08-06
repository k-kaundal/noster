import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';

/** NIP-51 bookmarks list — a replaceable, public list of saved events. */
export const BOOKMARKS_KIND = 10003;

/**
 * The signed-in user's bookmarks. The list is replaceable, so saving or
 * removing republishes the whole set rather than emitting a delta.
 */
export function useBookmarks() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['bookmarks', user?.pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);

      const events = await nostr.query(
        [{ kinds: [BOOKMARKS_KIND], authors: [user!.pubkey], limit: 1 }],
        { signal }
      );

      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) return { eventIds: [] as string[], addresses: [] as string[] };

      return {
        eventIds: latest.tags
          .filter(([name]) => name === 'e')
          .map(([, id]) => id)
          .filter(Boolean),
        addresses: latest.tags
          .filter(([name]) => name === 'a')
          .map(([, address]) => address)
          .filter(Boolean),
      };
    },
    enabled: !!user?.pubkey,
    staleTime: 60_000,
  });

  // Memoized so the identity is stable across renders for the callbacks below
  const eventIds = useMemo(() => query.data?.eventIds ?? [], [query.data]);
  const addresses = useMemo(() => query.data?.addresses ?? [], [query.data]);

  const isBookmarked = useCallback(
    (eventId: string) => eventIds.includes(eventId),
    [eventIds]
  );

  const toggle = useMutation({
    mutationFn: async (event: NostrEvent) => {
      if (!user) throw new Error('You must be logged in to bookmark');

      const alreadySaved = eventIds.includes(event.id);
      const nextIds = alreadySaved
        ? eventIds.filter((id) => id !== event.id)
        : [...eventIds, event.id];

      await createEvent({
        kind: BOOKMARKS_KIND,
        content: '',
        tags: [
          ...nextIds.map((id) => ['e', id]),
          ...addresses.map((address) => ['a', address]),
        ],
      });

      return !alreadySaved;
    },
    onSuccess: (saved) => {
      toast({
        title: saved ? 'Bookmarked' : 'Bookmark removed',
        duration: 2000,
      });
      queryClient.invalidateQueries({ queryKey: ['bookmarks', user?.pubkey] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Bookmark failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    eventIds,
    addresses,
    isLoading: query.isLoading,
    isBookmarked,
    toggle: toggle.mutateAsync,
    isToggling: toggle.isPending,
  };
}

/** Loads the actual events behind the signed-in user's bookmark list. */
export function useBookmarkedEvents() {
  const { nostr } = useNostr();
  const { eventIds, isLoading: listLoading } = useBookmarks();

  const query = useQuery({
    queryKey: ['bookmarked-events', eventIds.join(',')],
    queryFn: async (c) => {
      if (!eventIds.length) return [] as NostrEvent[];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const events = await nostr.query([{ ids: eventIds }], { signal });

      // Preserve the order the user saved them in, newest first
      const order = new Map(eventIds.map((id, index) => [id, index]));
      return events.sort(
        (a, b) => (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0)
      );
    },
    enabled: eventIds.length > 0,
  });

  return {
    events: query.data ?? [],
    isLoading: listLoading || query.isLoading,
    isEmpty: !listLoading && eventIds.length === 0,
  };
}
