import { useEffect, useRef } from 'react';

import { useLocalStorage } from '@/hooks/useLocalStorage';
import {
  countUnread,
  useNotifications,
  useNotificationsSeen,
} from '@/hooks/useNotifications';
import { setBadge, showNotice } from '@/lib/systemNotify';
import {
  EMPTY_LEDGER,
  FOLLOWERS_SEEN_KEY,
  rememberFollowers,
  unseenFollowers,
  type FollowerLedger,
} from '@/lib/followNotify';
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
    case 'follow':
      return { title: 'New follower', body: 'Someone started following you.' };
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

  /**
   * Who has already been counted as a follower.
   *
   * Needed because a follow has no event of its own — it is somebody's contact
   * list with your key in it, republished whole every time they edit their
   * follows. Judged on timestamp alone, the same person announces themselves
   * as a new follower every time they reorganise who they read.
   *
   * Held in a ref as well as in storage so the effect below can read the
   * current value without listing it as a dependency — writing to it there
   * would otherwise re-run the effect that just wrote it.
   */
  const [followers, setFollowers] = useLocalStorage<FollowerLedger>(
    FOLLOWERS_SEEN_KEY,
    EMPTY_LEDGER
  );

  const ledger = useRef(followers);
  useEffect(() => {
    ledger.current = followers;
  }, [followers]);

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
    if (!notifications.length) return;

    const newest = notifications[0].createdAt;

    /** Everyone currently visible as a follower, however old the list is. */
    const followerKeys = notifications
      .filter((notification) => notification.type === 'follow')
      .map((notification) => notification.pubkey);

    if (announcedThrough.current === null) {
      announcedThrough.current = newest;

      /*
       * The ledger is seeded from everything on screen, not from what arrives
       * next. On a device connecting for the first time this is the whole
       * follower list, and none of it is news — announcing it would greet
       * somebody with a notification per follower they have ever had.
       */
      setFollowers(rememberFollowers(followerKeys, ledger.current));
      return;
    }

    if (newest <= announcedThrough.current) return;

    const fresh = notifications.filter(
      (notification) => notification.createdAt > announcedThrough.current!
    );

    announcedThrough.current = newest;

    if (!enabled) {
      // Still recorded, so switching notifications on later does not replay
      // every follower as though they had just arrived
      setFollowers(rememberFollowers(followerKeys, ledger.current));
      return;
    }

    /**
     * Follows are filtered by who, not by when.
     *
     * A republished contact list is a fresh timestamp carrying no news, and it
     * is the common case — people edit their follows far more often than they
     * gain new ones. Only a key we have never counted is a new follower.
     */
    const newFollowers = new Set(
      unseenFollowers(
        fresh
          .filter((notification) => notification.type === 'follow')
          .map((notification) => notification.pubkey),
        ledger.current
      )
    );

    setFollowers(rememberFollowers(followerKeys, ledger.current));

    const announceable = fresh.filter(
      (notification) =>
        notification.type !== 'follow' || newFollowers.has(notification.pubkey)
    );

    if (!announceable.length) return;

    if (announceable.length > MAX_INDIVIDUAL) {
      showNotice({
        title: `${announceable.length} new notifications`,
        body: 'Zaps, replies, follows and mentions are waiting.',
        url: '/notifications',
        // One tag, so a later burst replaces this rather than piling up
        tag: 'nostrfeed-batch',
      });
      return;
    }

    for (const notification of announceable) {
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
  }, [enabled, notifications, setFollowers]);
}
