import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useMuteList } from '@/hooks/useMuteList';
import { partitionSpam, type SpamReason } from '@/lib/campaignSpam';
import {
  FOLLOW_KIND,
  NOTIFICATION_KINDS,
  buildNotifications,
  type Notification,
} from '@/lib/notifications';
import { isMuted } from '@/lib/mute';

const PAGE_SIZE = 50;

/**
 * Follows come back on their own budget.
 *
 * A contact list is one `p` tag per person followed, so a handful of them from
 * well-connected accounts is a page's worth of bytes on its own. Sharing a
 * limit with mentions meant whichever kind a relay returned first won, and the
 * cheap, frequent thing losing to the huge, rare one is the wrong way round.
 *
 * Smaller than the main page because they collapse to one row per follower
 * anyway — the extra copies are versions of a list, not more news.
 */
const FOLLOW_PAGE_SIZE = 20;

/**
 * Everything addressed to the signed-in user: mentions, replies, reactions,
 * reposts and zaps, in one query per page rather than one per kind.
 *
 * Shared by the header badge and the notifications page so opening the page
 * costs nothing extra.
 */
export function useNotifications() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { list: muteList } = useMuteList();
  const { followingList } = useFollows(user?.pubkey || '');

  const query = useInfiniteQuery({
    queryKey: ['notifications', user?.pubkey],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal: querySignal }) => {
      const signal = AbortSignal.any([querySignal, AbortSignal.timeout(5000)]);

      /*
       * Two filters, one request. Follows need a budget of their own — see
       * FOLLOW_PAGE_SIZE — and a second `nostr.query` for them would be a
       * second round trip against the relay's rate limit for something the
       * protocol lets us ask for in the same breath.
       */
      return nostr.query(
        [
          {
            kinds: NOTIFICATION_KINDS,
            '#p': [user!.pubkey],
            limit: PAGE_SIZE,
            ...(pageParam ? { until: pageParam } : {}),
          },
          {
            kinds: [FOLLOW_KIND],
            '#p': [user!.pubkey],
            limit: FOLLOW_PAGE_SIZE,
            ...(pageParam ? { until: pageParam } : {}),
          },
        ],
        { signal }
      );
    },
    getNextPageParam: (lastPage) => {
      /*
       * Each filter judged against its own limit. The page is the union of
       * two asks with different budgets, so comparing the total against either
       * one is wrong in both directions: against PAGE_SIZE it treats a handful
       * of follows as proof there is more, and against the sum it stops while
       * fifty mentions are still waiting.
       */
      const follows = lastPage.filter(
        (event) => event.kind === FOLLOW_KIND
      ).length;

      if (
        lastPage.length - follows < PAGE_SIZE &&
        follows < FOLLOW_PAGE_SIZE
      ) {
        return undefined;
      }
      const oldest = Math.min(...lastPage.map((event) => event.created_at));
      return oldest - 1;
    },
    enabled: !!user?.pubkey,
    refetchInterval: 60_000,
  });

  const following = useMemo(
    () => new Set(followingList.map((follow) => follow.pubkey)),
    [followingList]
  );

  const all = useMemo<Notification[]>(() => {
    if (!query.data || !user) return [];

    const events = query.data.pages
      .flat()
      // A muted person's like is still an interruption from a muted person
      .filter((event) => !isMuted(event, muteList));

    return buildNotifications(events, user.pubkey).filter(
      (notification) => !muteList.pubkeys.includes(notification.pubkey)
    );
  }, [query.data, user, muteList]);

  /**
   * Held back rather than deleted.
   *
   * The attack this exists for is one advert sent from a dozen fresh keys —
   * every per-author check passes it, because no single account did anything
   * unusual. Matching across authors catches it; see `lib/campaignSpam`.
   *
   * The split is returned whole so the page can show a count and let somebody
   * look. A filter nobody can inspect is indistinguishable from a bug, and the
   * one message it gets wrong is the one they most need to find.
   */
  const { notifications, spam, spamReasons } = useMemo(() => {
    if (!user) {
      return {
        notifications: all,
        spam: [] as Notification[],
        spamReasons: new Map<string, SpamReason[]>(),
      };
    }

    /**
     * Follows are not run through it.
     *
     * The filter's whole method is matching content across authors, and a
     * contact list has no content anybody wrote — most carry an empty string,
     * the rest a relay blob. Twenty followers therefore look exactly like
     * twenty copies of one message from twenty fresh keys, which is the
     * signature it exists to catch, so every follow after the second was being
     * held back as a spam campaign.
     */
    const follows = all.filter(
      (notification) => notification.type === 'follow'
    );

    const result = partitionSpam(
      all.filter((notification) => notification.type !== 'follow'),
      (notification) => notification.event,
      { following, self: user.pubkey }
    );

    return {
      notifications: [...result.kept, ...follows].sort(
        (a, b) => b.createdAt - a.createdAt
      ),
      spam: result.filtered,
      spamReasons: result.reasons,
    };
  }, [all, following, user]);

  return { ...query, notifications, spam, spamReasons };
}

/**
 * Tracks how much of the list the user has already seen. Stored locally rather
 * than published, since a read marker is device state, not something other
 * clients should act on.
 */
export function useNotificationsSeen() {
  const [lastSeen, setLastSeen] = useLocalStorage<number>(
    'nostr:notifications-seen',
    0
  );

  return {
    lastSeen,
    markSeen: (timestamp: number) => {
      // Never move the marker backwards, or old items would reappear as unread
      if (timestamp > lastSeen) setLastSeen(timestamp);
    },
  };
}

export function countUnread(
  notifications: Notification[],
  lastSeen: number
): number {
  return notifications.filter(
    (notification) => notification.createdAt > lastSeen
  ).length;
}
