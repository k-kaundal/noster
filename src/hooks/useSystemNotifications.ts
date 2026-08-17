import { useEffect, useRef } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useAccountStored } from '@/hooks/useStore';
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
import {
  ANNOUNCED_KEY,
  EMPTY_WATERMARK,
  advanced,
  newsFrom,
  watermarkFor,
  type Watermark,
} from '@/lib/notifyWatermark';
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
    case 'zap': {
      // The grouped total when several people zapped the same note, so the
      // interruption reports the whole of what arrived rather than the last of it
      const sats = notification.totalSats ?? notification.amountSats;
      const others = (notification.zapperCount ?? 1) - 1;

      return {
        title: sats ? `⚡ ${sats.toLocaleString()} sats` : '⚡ Zapped',
        body:
          others > 0
            ? `From ${others + 1} people on one note.`
            : notification.content || 'Someone zapped your note.',
      };
    }
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
  const { user } = useCurrentUser();
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
   *
   * Namespaced per account: one browser can hold several, and account B's
   * followers must not be treated as already-counted because account A had
   * met them.
   */
  const [followers, setFollowers] = useAccountStored<FollowerLedger>(
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
   * Stored rather than kept in memory, which is the fix for the same zap
   * arriving as a fresh notification hours later. See `lib/notifyWatermark`
   * for why a mark rebuilt at each launch cannot be trusted: it gets seeded
   * from one fast relay's partial answer, and everything the slower relays
   * add afterwards then looks new.
   */
  const [storedMark, setStoredMark] = useLocalStorage<Watermark>(
    ANNOUNCED_KEY,
    EMPTY_WATERMARK
  );

  const mark = useRef(storedMark);
  useEffect(() => {
    mark.current = storedMark;
  }, [storedMark]);

  useEffect(() => {
    setBadge(unread);
  }, [unread]);

  useEffect(() => {
    if (!user?.pubkey || !notifications.length) return;

    /** Everyone currently visible as a follower, however old the list is. */
    const followerKeys = notifications
      .filter((notification) => notification.type === 'follow')
      .map((notification) => notification.pubkey);

    const known = watermarkFor(mark.current, user.pubkey);

    /** Records how far we have looked, without announcing any of it. */
    const settle = () => {
      const next = advanced(known ?? EMPTY_WATERMARK, notifications, user.pubkey);

      if (!known || next.through !== known.through) {
        mark.current = next;
        setStoredMark(next);
      }

      setFollowers(rememberFollowers(followerKeys, ledger.current));
    };

    /*
     * Nothing on screen the first time we look at an account is news, and the
     * follower ledger is seeded from all of it rather than from what arrives
     * next — otherwise a device connecting for the first time greets somebody
     * with a notification per follower they have ever had.
     */
    if (!known) {
      settle();
      return;
    }

    const fresh = newsFrom(notifications, known);

    /**
     * Follows are filtered by who, not by when.
     *
     * A republished contact list is a fresh timestamp carrying no news, and it
     * is the common case — people edit their follows far more often than they
     * gain new ones. Only a key we have never counted is a new follower.
     *
     * Read before `settle`, which is what writes those keys into the ledger:
     * afterwards every one of them is known and none of them is new.
     */
    const newFollowers = new Set(
      unseenFollowers(
        fresh
          .filter((notification) => notification.type === 'follow')
          .map((notification) => notification.pubkey),
        ledger.current
      )
    );

    const announceable = fresh.filter(
      (notification) =>
        notification.type !== 'follow' || newFollowers.has(notification.pubkey)
    );

    // Recorded whether or not it gets announced, so switching notifications on
    // later does not replay everything that happened while they were off
    settle();

    if (!enabled || !announceable.length) return;

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
  }, [enabled, notifications, setFollowers, setStoredMark, user?.pubkey]);
}
