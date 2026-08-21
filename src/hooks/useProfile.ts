import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { TIMELINE_KINDS } from '@/lib/eventKinds';
import { useAdultContent } from '@/hooks/useAdultContent';
import { filterAdultContent } from '@/lib/nsfw';

export function useProfile(pubkey: string) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['profile', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);

      // Notes, reposts and metadata all travel in one request. The same kinds
      // as the home feed — asking for fewer here is what hid someone's own
      // poll from their own profile while everyone else could see it.
      const events = await nostr.query(
        [
          { kinds: TIMELINE_KINDS, authors: [pubkey], limit: 60 },
          { kinds: [0], authors: [pubkey], limit: 1 },
        ],
        { signal }
      );

      const posts = events
        .filter(
          (event) =>
            event.kind !== 0 &&
            event.created_at > 0 &&
            event.created_at < Date.now() / 1000 + 86400
        )
        .sort((a, b) => b.created_at - a.created_at);

      return {
        posts,
        metadata: events.find((event) => event.kind === 0) || null,
      };
    },
    enabled: !!pubkey,
  });

  const { showAdult } = useAdultContent();

  /*
   * Adult content, and not the mute list.
   *
   * Those pull in opposite directions here and both readings are defensible,
   * so the distinction is where somebody's intent is. Opening a profile is a
   * deliberate act — hiding what a muted account posted on their own page
   * would leave a blank screen with no explanation of why. Adult content
   * switched off is not about a person at all; it is about who can see the
   * screen, and that does not stop applying because of which page is open.
   */
  return useMemo(() => {
    if (!query.data) return query;

    return {
      ...query,
      data: {
        ...query.data,
        posts: filterAdultContent(query.data.posts, showAdult),
      },
    };
  }, [query, showAdult]);
}
