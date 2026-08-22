import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { authorQueryKey, type AuthorData } from '@/hooks/useAuthor';
import { partitionSpam, type SpamReason } from '@/lib/campaignSpam';

/**
 * Which notes the timeline should hold back, and why.
 *
 * The judgement itself is `lib/campaignSpam`, which has been deciding this for
 * notifications since it was written — the same duplicate fingerprinting, the
 * same cross-author campaign detection, the same rule that anything from
 * somebody you follow is never touched. It was simply never asked about the
 * feed, which is the screen carrying the most events and the only one a
 * stranger can reach without being mentioned.
 *
 * Held back rather than deleted, exactly as notifications does it. A filter
 * nobody can inspect is indistinguishable from a bug, and the note it gets
 * wrong is by definition the one somebody most needs to find — so this returns
 * both halves and the reason, and the feed shows a count with a way to look.
 *
 * Costs nothing on the network. The follow list is already loaded for the
 * Following tab, and the profiles come out of the author cache that was
 * populated to draw each note's avatar — an author whose kind 0 has not
 * arrived is absent from the map rather than present and empty, which is what
 * stops every stranger being judged blank while their profile is in flight.
 */
export function useFeedSpam(events: NostrEvent[] | undefined) {
  const { user } = useCurrentUser();
  const { followingList } = useFollows(user?.pubkey || '');
  const client = useQueryClient();

  const following = useMemo(
    () => new Set(followingList.map((follow) => follow.pubkey)),
    [followingList]
  );

  return useMemo(() => {
    if (!events?.length) {
      return {
        kept: events,
        filtered: [] as NostrEvent[],
        reasons: new Map<string, SpamReason[]>(),
      };
    }

    /*
     * Read, never fetched. `getQueryData` returns what is already in hand, so
     * a cold feed judges on campaigns alone and the profile rule starts
     * applying as the avatars fill in — which is the right way round, since
     * the alternative is a request per author to decide whether to show them.
     */
    const profiles = new Map<
      string,
      { name?: string; display_name?: string; picture?: string; about?: string } | undefined
    >();

    for (const event of events) {
      if (profiles.has(event.pubkey)) continue;

      const cached = client.getQueryData<AuthorData>(
        authorQueryKey(event.pubkey)
      );
      if (cached) profiles.set(event.pubkey, cached.metadata);
    }

    return partitionSpam(
      events,
      (event) => event,
      { following, self: user?.pubkey },
      profiles
    );
  }, [events, following, user?.pubkey, client]);
}
