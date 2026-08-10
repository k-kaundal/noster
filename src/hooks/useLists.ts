import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  FOLLOW_SET_KIND,
  LIST_KINDS,
  buildListTags,
  dedupeLists,
  parsePeopleList,
  type ListDraft,
  type PeopleList,
} from '@/lib/lists';

const LIMIT = 60;

/**
 * People lists published to the current relays.
 *
 * Both kinds are asked for in one filter rather than two queries: a follow set
 * and a starter pack are the same thing to a reader, and splitting them would
 * spend two round trips to produce one list.
 */
export function useLists(author?: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['people-lists', author ?? 'all'],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [
          {
            kinds: LIST_KINDS,
            limit: LIMIT,
            ...(author ? { authors: [author] } : {}),
          },
        ],
        { signal }
      );

      return dedupeLists(
        events
          .map((event) => parsePeopleList(event))
          .filter((list): list is NonNullable<typeof list> => list !== null)
      );
    },
    staleTime: 60 * 1000,
  });
}

/** The signed-in user's own lists, including ones still being filled in. */
export function useMyLists() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['people-lists', 'mine', user?.pubkey ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [{ kinds: LIST_KINDS, authors: [user!.pubkey], limit: LIMIT }],
        { signal }
      );

      return dedupeLists(
        events
          // Your own empty list is one you are still building, not a broken
          // event to hide from you
          .map((event) => parsePeopleList(event, { allowEmpty: true }))
          .filter((list): list is NonNullable<typeof list> => list !== null)
      );
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  return { lists: query.data ?? [], isLoading: query.isLoading };
}

/**
 * One list, by its address.
 *
 * Read leniently: an `naddr` is a link someone followed deliberately, so an
 * empty or reserved set is shown rather than reported missing. "Not found"
 * should mean the relay does not have it.
 */
export function useList(pubkey: string, identifier: string, kind: number) {
  const { nostr } = useNostr();

  const query = useQuery<PeopleList | null>({
    queryKey: ['people-list', kind, pubkey, identifier],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [{ kinds: [kind], authors: [pubkey], '#d': [identifier], limit: 5 }],
        { signal }
      );

      // Relays can each hold a different revision of an addressable event
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!newest) return null;

      return parsePeopleList(newest, {
        allowEmpty: true,
        allowReserved: true,
      });
    },
    enabled: !!pubkey && !!identifier && LIST_KINDS.includes(kind),
    staleTime: 30 * 1000,
  });

  return {
    list: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}

/**
 * Creates or replaces a list.
 *
 * The same call does both, because an addressable event has no separate
 * create: publishing kind 30000 with a `d` value that already exists replaces
 * it. What decides which happened is whether the caller kept the identifier.
 */
export function useSaveList() {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      draft,
      kind = FOLLOW_SET_KIND,
    }: {
      draft: ListDraft;
      kind?: number;
    }) => {
      if (!user) throw new Error('Log in to make a list');
      if (!draft.title.trim()) throw new Error('Give the list a name');

      await publishEvent({
        kind,
        // NIP-51 keeps private members here, NIP-44 encrypted. This app writes
        // public lists only, so there is nothing to put in it.
        content: '',
        tags: buildListTags(draft),
      });

      return draft;
    },
    onSuccess: (draft) => {
      const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['people-lists'] });
        queryClient.invalidateQueries({ queryKey: ['people-list'] });
      };

      refresh();

      // Again shortly after, because a relay that has accepted an event has
      // not necessarily indexed it yet — and a list that is missing from the
      // page you were just returned to reads as a save that did not happen
      setTimeout(refresh, 1500);

      toast({
        title: 'List saved',
        description: `"${draft.title}" is published to your relays.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not save the list',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Asks relays to drop a list.
 *
 * A request, not a guarantee — NIP-09 deletion is advisory and a relay may
 * keep serving it. Said plainly in the confirmation rather than promised.
 */
export function useDeleteList() {
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (list: PeopleList) => {
      await publishEvent({
        kind: 5,
        content: '',
        tags: [
          ['a', list.address],
          ['e', list.event.id],
          ['k', String(list.kind)],
        ],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people-lists'] });
      queryClient.invalidateQueries({ queryKey: ['people-list'] });

      toast({
        title: 'Deletion requested',
        description: 'Relays that honour deletions will drop it.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not delete the list',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
