import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useMuteList } from '@/hooks/useMuteList';
import { partitionSpam, type SpamReason } from '@/lib/campaignSpam';
import {
  NOTIFICATION_KINDS,
  buildNotifications,
  type Notification,
} from '@/lib/notifications';
import { isMuted } from '@/lib/mute';

const PAGE_SIZE = 50;

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

      return nostr.query(
        [
          {
            kinds: NOTIFICATION_KINDS,
            '#p': [user!.pubkey],
            limit: PAGE_SIZE,
            ...(pageParam ? { until: pageParam } : {}),
          },
        ],
        { signal }
      );
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
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

    const result = partitionSpam(
      all,
      (notification) => notification.event,
      { following, self: user.pubkey }
    );

    return {
      notifications: result.kept,
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
