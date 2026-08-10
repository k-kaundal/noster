import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { useToast } from './useToast';
import { contactTags, latestContactList, reviseContacts } from '@/lib/contacts';

/**
 * Long enough for a slow relay to answer.
 *
 * This is not a display timeout. The contact list read here is what a follow
 * is written back from, so answering "I don't know" quickly is the dangerous
 * outcome, not the safe one.
 */
const CONTACT_LIST_TIMEOUT = 5000;

export function useFollows(pubkey: string) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const fetchContactList = async (
    author: string,
    signal: AbortSignal
  ): Promise<NostrEvent | undefined> => {
    // No `limit: 1`: one event per relay is exactly what has to be compared,
    // and a limit of one would let each relay decide which revision that is
    const events = await nostr.query([{ kinds: [3], authors: [author] }], {
      signal,
    });

    return latestContactList(events);
  };

  const followListQuery = useQuery({
    queryKey: ['follows', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([
        c.signal,
        AbortSignal.timeout(CONTACT_LIST_TIMEOUT),
      ]);

      return (await fetchContactList(pubkey, signal)) ?? null;
    },
    enabled: !!pubkey,
  });

  const currentUserFollowsQuery = useQuery({
    queryKey: ['follows', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return null;

      const signal = AbortSignal.any([
        c.signal,
        AbortSignal.timeout(CONTACT_LIST_TIMEOUT),
      ]);

      return (await fetchContactList(user.pubkey, signal)) ?? null;
    },
    enabled: !!user?.pubkey,
  });

  const followingList = contactTags(
    followListQuery.data ?? undefined
  ).map((tag) => ({
    pubkey: tag[1],
    relay: tag[2] || '',
    petname: tag[3] || '',
  }));

  const currentUserFollowing = contactTags(
    currentUserFollowsQuery.data ?? undefined
  ).map((tag) => tag[1]);

  const isFollowing = currentUserFollowing.includes(pubkey);
  const followingCount = followingList.length;

  /**
   * Rewrites the contact list.
   *
   * Every follow republishes the whole list, so this is the one place in the
   * app where getting a read wrong destroys data rather than displaying it
   * wrong. Three things protect it:
   *
   * 1. The list is re-read at the moment of writing, not taken from whatever
   *    the cache happened to hold — which may be from before the last change,
   *    or from a query that timed out.
   * 2. The newest revision across relays wins, and the freshly read one is
   *    compared against the cached one in case the read came back with less.
   * 3. If nothing can be read at all, it stops. Publishing a list of one from
   *    a failed read is how a thousand follows disappear.
   */
  const followMutation = useMutation({
    mutationFn: async ({
      add = [],
      remove = [],
    }: {
      add?: string[];
      remove?: string[];
    }) => {
      if (!user) throw new Error('User not logged in');

      const fresh = await fetchContactList(
        user.pubkey,
        AbortSignal.timeout(CONTACT_LIST_TIMEOUT)
      );

      const cached = currentUserFollowsQuery.data ?? undefined;
      const base = latestContactList(
        [fresh, cached].filter((event): event is NostrEvent => !!event)
      );

      /**
       * Never publish a contact list built from nothing.
       *
       * Someone with follows whose relays are briefly unreachable would
       * otherwise have all of them replaced by the single person they just
       * clicked — irreversibly, since the new event supersedes the old one
       * everywhere it reaches.
       */
      if (!base && currentUserFollowing.length > 0) {
        throw new Error(
          'Could not read your follow list, so it was left alone. Try again in a moment.'
        );
      }

      const existing = contactTags(base);
      const tags = reviseContacts(existing, { add, remove });

      const event = await createEvent({
        kind: 3,
        // Kept as it was. Kind 3 content historically carries a relay list,
        // and blanking it discards settings this app never displayed.
        content: base?.content ?? '',
        tags,
      });

      /**
       * Written into the cache immediately.
       *
       * Following several people in a row — adding everyone in a list, say —
       * means the next call reads this one's result. Waiting for a refetch
       * would have each of them build on the list from before the first, and
       * the last to publish would win.
       */
      queryClient.setQueryData(['follows', user.pubkey], event);

      const before = new Set(existing.map((tag) => tag[1]));
      const after = new Set(tags.map((tag) => tag[1]));

      return {
        added: [...after].filter((entry) => !before.has(entry)).length,
        removed: [...before].filter((entry) => !after.has(entry)).length,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['follows', user?.pubkey] });
      queryClient.invalidateQueries({ queryKey: ['followers', pubkey] });

      if (result.added && !result.removed) {
        toast({
          title: result.added === 1 ? 'Followed' : `Followed ${result.added}`,
          description: 'Added to your following list.',
        });
      } else if (result.removed) {
        toast({
          title: 'Unfollowed',
          description: 'Removed from your following list.',
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not update your follows',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    followList: followListQuery.data ?? undefined,
    followingList,
    followingCount,
    isFollowing,
    isLoading: followListQuery.isLoading,
    follow: (targetPubkey: string) =>
      followMutation.mutateAsync({ add: [targetPubkey] }),
    unfollow: (targetPubkey: string) =>
      followMutation.mutateAsync({ remove: [targetPubkey] }),
    /** Adds several people in one revision, rather than one publish each. */
    followMany: (targetPubkeys: string[]) =>
      followMutation.mutateAsync({ add: targetPubkeys }),
    isFollowLoading: followMutation.isPending,
  };
}
