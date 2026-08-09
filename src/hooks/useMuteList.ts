import { useCallback, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  EMPTY_MUTE_LIST,
  MUTE_LIST_KIND,
  buildMuteListTags,
  parseMuteList,
  type MuteList,
  type MutedItem,
  isActiveMute,
} from '@/lib/mute';

/**
 * The signed-in user's NIP-51 mute list. It is a public, replaceable event, so
 * every change republishes the whole list and travels with the account to any
 * other client.
 */
export function useMuteList() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['mute-list', user?.pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);
      const events = await nostr.query(
        [{ kinds: [MUTE_LIST_KIND], authors: [user!.pubkey], limit: 1 }],
        { signal }
      );

      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      return parseMuteList(latest);
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60 * 1000,
  });

  // A stable empty list keeps downstream memos from re-running every render
  const list = useMemo(() => query.data ?? EMPTY_MUTE_LIST, [query.data]);

  const publish = useMutation({
    mutationFn: async (next: MuteList) => {
      if (!user) throw new Error('You must be logged in to mute');
      await createEvent({
        kind: MUTE_LIST_KIND,
        content: '',
        tags: buildMuteListTags(next),
      });
      return next;
    },
    onMutate: async (next) => {
      // Muting should take effect before the relay confirms
      const key = ['mute-list', user?.pubkey];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MuteList>(key);
      queryClient.setQueryData(key, next);
      return { previous };
    },
    onError: (error: Error, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['mute-list', user?.pubkey], context.previous);
      }
      toast({
        title: 'Could not update mute list',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['mute-list', user?.pubkey] });
    },
  });

  const update = publish.mutateAsync;

  const muteUser = useCallback(
    (pubkey: string) => {
      if (list.pubkeys.includes(pubkey)) return Promise.resolve(list);
      return update({ ...list, pubkeys: [...list.pubkeys, pubkey] });
    },
    [list, update]
  );

  const unmuteUser = useCallback(
    (pubkey: string) =>
      update({
        ...list,
        pubkeys: list.pubkeys.filter((entry) => entry !== pubkey),
      }),
    [list, update]
  );

  const muteWord = useCallback(
    (word: string) => {
      const value = word.trim().toLowerCase();
      if (!value || list.words.includes(value)) return Promise.resolve(list);
      return update({ ...list, words: [...list.words, value] });
    },
    [list, update]
  );

  const unmuteWord = useCallback(
    (word: string) =>
      update({
        ...list,
        words: list.words.filter((entry) => entry !== word.toLowerCase()),
      }),
    [list, update]
  );

  const muteHashtag = useCallback(
    (tag: string) => {
      const value = tag.trim().replace(/^#/, '').toLowerCase();
      if (!value || list.hashtags.includes(value)) return Promise.resolve(list);
      return update({ ...list, hashtags: [...list.hashtags, value] });
    },
    [list, update]
  );

  const unmuteHashtag = useCallback(
    (tag: string) =>
      update({
        ...list,
        hashtags: list.hashtags.filter(
          (entry) => entry !== tag.replace(/^#/, '').toLowerCase()
        ),
      }),
    [list, update]
  );

  const isUserMuted = useCallback(
    (pubkey: string) => {
      return list.pubkeys.some((item) => {
        const value = typeof item === 'string' ? item : item.value;
        if (value !== pubkey) return false;
        return isActiveMute(item);
      });
    },
    [list]
  );

  const muteUserTemporarily = useCallback(
    (pubkey: string, durationMs: number) => {
      if (list.pubkeys.some((p) => {
        const value = typeof p === 'string' ? p : p.value;
        return value === pubkey && isActiveMute(p);
      })) {
        return Promise.resolve(list);
      }

      const expiry = Math.floor((Date.now() + durationMs) / 1000);
      const item: MutedItem = { value: pubkey, expiry };
      return update({ ...list, pubkeys: [...list.pubkeys, item] });
    },
    [list, update]
  );

  const softMuteUser = useCallback(
    (pubkey: string) => {
      if (list.pubkeys.some((p) => {
        const value = typeof p === 'string' ? p : p.value;
        return value === pubkey;
      })) {
        return Promise.resolve(list);
      }

      const item: MutedItem = { value: pubkey, soft: true };
      return update({ ...list, pubkeys: [...list.pubkeys, item] });
    },
    [list, update]
  );

  return {
    list,
    isLoading: query.isLoading,
    isUpdating: publish.isPending,
    isUserMuted,
    muteUser,
    unmuteUser,
    muteUserTemporarily,
    softMuteUser,
    muteWord,
    unmuteWord,
    muteHashtag,
    unmuteHashtag,
  };
}
