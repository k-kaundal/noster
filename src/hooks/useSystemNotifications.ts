import { useEffect, useRef } from 'react';

import { useLocalStorage } from '@/hooks/useLocalStorage';
import {
  countUnread,
  useNotifications,
  useNotificationsSeen,
} from '@/hooks/useNotifications';
import { setBadge, showNotice } from '@/lib/systemNotify';
import type { Notification } from '@/lib/notifications';

/**
 * How many system notifications one arrival of new items may raise.
 *
 * Coming back to fifty mentions should not produce fifty system
 * notifications — that is an operating-system-level denial of service on your
 * own user. Past this they are summarised into one line.
 */
const MAX_INDIVIDUAL = 3;

/** The reader's own switch, off until they turn it on. */
export const NOTIFY_PREF_KEY = 'nostr:system-notifications';

function describe(notification: Notification): { title: string; body: string } {
  switch (notification.type) {
    case 'zap':
      return {
        title: notification.amountSats
          ? `⚡ ${notification.amountSats.toLocaleString()} sats`
          : '⚡ Zapped',
        body: notification.content || 'Someone zapped your note.',
      };
    case 'reply':
      return { title: 'New reply', body: notification.content.slice(0, 140) };
    case 'mention':
      return { title: 'Mentioned you', body: notification.content.slice(0, 140) };
    case 'repost':
      return { title: 'Reposted your note', body: '' };
    case 'reaction':
      return {
        title: `Reacted ${notification.content || '❤️'}`,
        body: '',
      };
    default:
      return { title: 'New activity', body: notification.content.slice(0, 140) };
  }
}

/**
 * Raises system notifications for new arrivals, and keeps the icon badge in
 * step with the unread count.
 *
 * Mounted once, in the layout, rather than per page: it has to keep working
 * while the reader is on any screen, and two copies would announce everything
 * twice.
 */
export function useSystemNotifications() {
  const { notifications } = useNotifications();
  const { lastSeen } = useNotificationsSeen();
  const [enabled] = useLocalStorage(NOTIFY_PREF_KEY, false);

  const unread = countUnread(notifications, lastSeen);

  /**
   * The newest item already announced.
   *
   * Seeded on the first run rather than starting at zero, so opening the app
   * does not announce the entire backlog as if it had just happened. Only
   * things that arrive *after* this session began are new.
   */
  const announcedThrough = useRef<number | null>(null);

  useEffect(() => {
    setBadge(unread);
  }, [unread]);

  useEffect(() => {
    if (!enabled || !notifications.length) return;

    const newest = notifications[0].createdAt;

    if (announcedThrough.current === null) {
      announcedThrough.current = newest;
      return;
    }

    if (newest <= announcedThrough.current) return;

    const fresh = notifications.filter(
      (notification) => notification.createdAt > announcedThrough.current!
    );

    announcedThrough.current = newest;

    if (fresh.length > MAX_INDIVIDUAL) {
      showNotice({
        title: `${fresh.length} new notifications`,
        body: 'Zaps, replies and mentions are waiting.',
        url: '/notifications',
        // One tag, so a later burst replaces this rather than piling up
        tag: 'nostrfeed-batch',
      });
      return;
    }

    for (const notification of fresh) {
      const { title, body } = describe(notification);

      showNotice({
        title,
        body,
        url: '/notifications',
        /**
         * Tagged per event, so the same notification arriving twice — a
         * refetch returning it again — replaces itself rather than appearing
         * a second time.
         */
        tag: notification.event.id,
      });
    }
  }, [enabled, notifications]);
}
