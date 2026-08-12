import { useCallback, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { decryptListItems, encryptListItems } from '@/lib/nip51';
import {
  EMPTY_MUTE_LIST,
  MUTE_LIST_KIND,
  buildMuteListTags,
  getMuteValue,
  mergeMuteLists,
  parseMuteList,
  parseMuteTags,
  type MuteList,
  type MutedItem,
  isActiveMute,
} from '@/lib/mute';

/** Which half of the list an entry lives in. */
export interface MuteVisibility {
  /**
   * Encrypted into the event's content, readable only by its author.
   *
   * The default for new mutes. A mute list published in the open tells
   * everybody exactly who somebody has blocked — which is an odd thing to
   * announce, and a ready-made target list for the people on it.
   */
  private?: boolean;
}

interface MuteHalves {
  public: MuteList;
  private: MuteList;
}

const EMPTY_HALVES: MuteHalves = {
  public: EMPTY_MUTE_LIST,
  private: EMPTY_MUTE_LIST,
};

/**
 * The signed-in user's NIP-51 mute list, both halves.
 *
 * Replaceable, so every change republishes the whole thing — the public
 * entries as tags and the private ones NIP-44 encrypted into the content, per
 * the spec. `list` is the two merged, because everything that filters a feed
 * wants one answer to "is this muted" and does not care where the entry lived.
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
      if (!latest) return EMPTY_HALVES;

      /**
       * Decryption failing is not an error here — an older signer without
       * NIP-44, or a list encrypted under a key this login no longer holds,
       * both land as "no private entries". The public half still works, which
       * is better than an empty mute list and a red toast.
       */
      const privateTags = await decryptListItems(
        latest,
        user!.signer,
        user!.pubkey
      );

      return {
        public: parseMuteList(latest),
        private: parseMuteTags(privateTags),
      };
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60 * 1000,
  });

  const halves = query.data ?? EMPTY_HALVES;

  // A stable merged list keeps downstream memos from re-running every render
  const list = useMemo(
    () => mergeMuteLists(halves.public, halves.private),
    [halves.public, halves.private]
  );

  const publish = useMutation({
    mutationFn: async (next: MuteHalves) => {
      if (!user) throw new Error('You must be logged in to mute');

      await createEvent({
        kind: MUTE_LIST_KIND,
        content: await encryptListItems(
          buildMuteListTags(next.private),
          user.signer,
          user.pubkey
        ),
        tags: buildMuteListTags(next.public),
      });

      return next;
    },
    onMutate: async (next) => {
      // Muting should take effect before the relay confirms
      const key = ['mute-list', user?.pubkey];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MuteHalves>(key);
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

  type Field = keyof MuteList;

  /**
   * Adds an entry to one half and removes it from the other.
   *
   * The move matters: an entry left behind in the public half after being
   * muted privately would still announce itself, and one left in the private
   * half after being unmuted publicly would keep muting in secret. Appended
   * rather than prepended, as the spec asks — "clients SHOULD append them to
   * the end of the list, so they are stored in chronological order".
   */
  const put = useCallback(
    (field: Field, item: string | MutedItem, options: MuteVisibility = {}) => {
      const value = getMuteValue(item);
      const strip = (entries: (string | MutedItem)[]) =>
        entries.filter((entry) => getMuteValue(entry) !== value);

      const target = options.private ? 'private' : 'public';
      const other = options.private ? 'public' : 'private';

      return update({
        ...halves,
        [target]: {
          ...halves[target],
          [field]: [...strip(halves[target][field]), item],
        },
        [other]: {
          ...halves[other],
          [field]: strip(halves[other][field]),
        },
      } as MuteHalves);
    },
    [halves, update]
  );

  /** Removes an entry from both halves, wherever it happens to live. */
  const drop = useCallback(
    (field: Field, value: string) => {
      const strip = (entries: (string | MutedItem)[]) =>
        entries.filter((entry) => getMuteValue(entry) !== value);

      return update({
        public: { ...halves.public, [field]: strip(halves.public[field]) },
        private: { ...halves.private, [field]: strip(halves.private[field]) },
      });
    },
    [halves, update]
  );

  const has = useCallback(
    (field: Field, value: string) =>
      list[field].some((entry) => getMuteValue(entry) === value),
    [list]
  );

  const muteUser = useCallback(
    (pubkey: string, options?: MuteVisibility) => {
      if (has('pubkeys', pubkey)) return Promise.resolve(halves);
      return put('pubkeys', pubkey, options);
    },
    [has, put, halves]
  );

  const unmuteUser = useCallback(
    (pubkey: string) => drop('pubkeys', pubkey),
    [drop]
  );

  const muteWord = useCallback(
    (word: string, options?: MuteVisibility) => {
      const value = word.trim().toLowerCase();
      if (!value || has('words', value)) return Promise.resolve(halves);
      return put('words', value, options);
    },
    [has, put, halves]
  );

  const unmuteWord = useCallback(
    (word: string) => drop('words', word.trim().toLowerCase()),
    [drop]
  );

  const muteHashtag = useCallback(
    (tag: string, options?: MuteVisibility) => {
      const value = tag.trim().replace(/^#/, '').toLowerCase();
      if (!value || has('hashtags', value)) return Promise.resolve(halves);
      return put('hashtags', value, options);
    },
    [has, put, halves]
  );

  const unmuteHashtag = useCallback(
    (tag: string) => drop('hashtags', tag.trim().replace(/^#/, '').toLowerCase()),
    [drop]
  );

  const isUserMuted = useCallback(
    (pubkey: string) =>
      list.pubkeys.some(
        (item) => getMuteValue(item) === pubkey && isActiveMute(item)
      ),
    [list]
  );

  /** Whether an entry is in the private half, for showing it differently. */
  const isPrivatelyMuted = useCallback(
    (value: string) =>
      [
        ...halves.private.pubkeys,
        ...halves.private.words,
        ...halves.private.hashtags,
        ...halves.private.threads,
      ].some((item) => getMuteValue(item) === value),
    [halves.private]
  );

  const muteUserTemporarily = useCallback(
    (pubkey: string, durationMs: number, options?: MuteVisibility) => {
      if (
        list.pubkeys.some(
          (item) => getMuteValue(item) === pubkey && isActiveMute(item)
        )
      ) {
        return Promise.resolve(halves);
      }

      const expiry = Math.floor((Date.now() + durationMs) / 1000);
      return put('pubkeys', { value: pubkey, expiry }, options);
    },
    [list, put, halves]
  );

  const softMuteUser = useCallback(
    (pubkey: string, options?: MuteVisibility) => {
      if (has('pubkeys', pubkey)) return Promise.resolve(halves);
      return put('pubkeys', { value: pubkey, soft: true }, options);
    },
    [has, put, halves]
  );

  /**
   * Whether private entries are possible at all.
   *
   * An older extension with no NIP-44 cannot encrypt, and offering the choice
   * anyway would produce a mute that fails at publish time — the worst moment
   * to find out, since the user believes they have already muted somebody.
   */
  const canBePrivate = !!user?.signer?.nip44;

  return {
    list,
    publicList: halves.public,
    privateList: halves.private,
    canBePrivate,
    isLoading: query.isLoading,
    isUpdating: publish.isPending,
    isUserMuted,
    isPrivatelyMuted,
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
