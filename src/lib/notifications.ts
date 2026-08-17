import type { NostrEvent } from '@nostrify/nostrify';
import { parseZapReceipt, ZAP_RECEIPT_KIND } from '@/lib/zap';
import { reactionEmoji } from '@/lib/reactions';

export type NotificationType =
  | 'mention'
  | 'reply'
  | 'quote'
  | 'reaction'
  | 'repost'
  | 'zap'
  | 'follow';

export interface Notification {
  /** The event that triggered it — also the React key. */
  event: NostrEvent;
  type: NotificationType;
  /** Who did it. For zaps this is the sender, not the receipt signer. */
  pubkey: string;
  createdAt: number;
  /** The note being reacted to, replied to, or zapped. */
  targetEventId: string | null;
  /** Reaction emoji, or the zapper's message. */
  content: string;
  /** Zaps only. */
  amountSats: number | null;
  /** Zaps only: the invoice, for matching a receipt against a wallet's ledger. */
  bolt11?: string | null;
  /**
   * Zaps only: how many people this row stands for.
   *
   * Absent when it stands for one, so a row that was never merged reads
   * exactly as it did before.
   */
  zapperCount?: number;
  /** Zaps only: the total across those people, when several were merged. */
  totalSats?: number | null;
}

/** Kinds worth notifying about, in one filter to keep the query count down. */
export const NOTIFICATION_KINDS = [1, 6, 7, 16, ZAP_RECEIPT_KIND];

/**
 * NIP-02 contact list. Somebody following you is them republishing this with
 * your key in it, so it is the only evidence a follow ever produces.
 *
 * Deliberately *not* in `NOTIFICATION_KINDS`. A contact list carries a `p` tag
 * per person followed, so a single one from a well-connected account is tens of
 * kilobytes, and asking for these in the same filter as mentions means one
 * page of fifty can come back as fifty follow lists with every reply pushed off
 * the end. It gets a filter and a limit of its own; see `useNotifications`.
 */
export const FOLLOW_KIND = 3;

function referencedEventId(event: NostrEvent): string | null {
  // A reply's target is its last "e" tag under the positionless convention,
  // and its marked "reply"/"root" tag under NIP-10. A "mention" marker is a
  // quote, so it is dropped before any of that — treating one as a reply is
  // what put quotes inside the threads they were talking about.
  const eTags = event.tags.filter(
    ([name, , , marker]) => name === 'e' && marker !== 'mention'
  );
  if (!eTags.length) return null;

  const reply = eTags.find(([, , , marker]) => marker === 'reply');
  if (reply) return reply[1];

  const root = eTags.find(([, , , marker]) => marker === 'root');
  if (root) return root[1];

  return eTags[eTags.length - 1][1];
}

/**
 * The note a kind 1 is quoting, if it is quoting one.
 *
 * Two spellings, both current: a `q` tag, which is what NIP-18 settled on, and
 * an `e` tag marked `mention`, which is the older NIP-10 form still sent by
 * plenty of clients.
 */
function quotedEventId(event: NostrEvent): string | null {
  const q = event.tags.find(([name, value]) => name === 'q' && !!value);
  if (q) return q[1];

  const mention = event.tags.find(
    ([name, value, , marker]) => name === 'e' && !!value && marker === 'mention'
  );

  return mention?.[1] ?? null;
}

/**
 * Turns a raw event into a notification, or null when it isn't one for this
 * user. Self-authored events are dropped: being told about your own likes is
 * noise, and zapping yourself is a real thing people do to test wallets.
 */
export function toNotification(
  event: NostrEvent,
  pubkey: string
): Notification | null {
  if (event.kind === ZAP_RECEIPT_KIND) {
    const zap = parseZapReceipt(event);
    if (!zap.senderPubkey || zap.senderPubkey === pubkey) return null;

    return {
      event,
      type: 'zap',
      pubkey: zap.senderPubkey,
      createdAt: event.created_at,
      targetEventId: zap.targetEventId,
      content: zap.comment,
      amountSats: zap.amountSats,
      bolt11: zap.bolt11,
    };
  }

  if (event.pubkey === pubkey) return null;

  if (event.kind === FOLLOW_KIND) {
    /**
     * Checked rather than assumed. A relay's `#p` filter matches any `p` tag,
     * and this is the one kind where the tag means something specific — being
     * named in somebody's contact list *is* the follow. A list that came back
     * without your key in it is a relay being loose, and reporting it would
     * announce a follow that did not happen.
     */
    const follows = event.tags.some(
      ([name, value]) => name === 'p' && value === pubkey
    );
    if (!follows) return null;

    return {
      event,
      type: 'follow',
      pubkey: event.pubkey,
      createdAt: event.created_at,
      targetEventId: null,
      // A contact list's content is a relay blob, never a message to anyone
      content: '',
      amountSats: null,
    };
  }

  const target = referencedEventId(event);
  const quoted = quotedEventId(event);

  const type: NotificationType =
    event.kind === 7
      ? 'reaction'
      : event.kind === 6 || event.kind === 16
        ? 'repost'
        : // A reply answers inside the thread; a quote lifts the note out into
          // a post of its own. Both notify, and they are not the same event to
          // the person being notified — one continues a conversation, the
          // other starts one about them somewhere else.
          target
          ? 'reply'
          : quoted
            ? 'quote'
            : 'mention';

  return {
    event,
    type,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    // A quote's target is the note it lifted, so the row links there
    targetEventId: target ?? quoted,
    content:
      event.kind === 7
        ? reactionEmoji(event)
        : type === 'repost'
          ? repostedContent(event)
          : event.content,
    amountSats: null,
  };
}

/**
 * What a repost was actually a repost of.
 *
 * NIP-18 lets a kind 6 carry the whole original event, serialised, in its
 * `content` — and that is what was being printed into the notification: a
 * wall of JSON with the id, pubkey, tags and signature in it, headed "Note:".
 * The note itself was in there, buried in an escaped string.
 *
 * So it is unwrapped. An empty result is correct and common: most clients send
 * kind 6 with no content at all, and the row simply shows who reposted without
 * a preview rather than inventing one.
 */
export function repostedContent(event: NostrEvent): string {
  const raw = event.content?.trim();
  if (!raw) return '';

  // Only a JSON object can be an embedded event; anything else is a client
  // that put its own text there, and that text is the better preview
  if (!raw.startsWith('{')) return raw;

  try {
    const embedded = JSON.parse(raw) as Partial<NostrEvent>;

    return typeof embedded?.content === 'string' ? embedded.content : '';
  } catch {
    // Truncated or malformed. Showing nothing beats showing the fragment.
    return '';
  }
}

/** Builds the notification list, newest first, with duplicates removed. */
export function buildNotifications(
  events: NostrEvent[],
  pubkey: string
): Notification[] {
  const seen = new Set<string>();
  const notifications: Notification[] = [];

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);

    const notification = toNotification(event, pubkey);
    if (notification) notifications.push(notification);
  }

  return groupZaps(collapseFollows(notifications)).sort(
    (a, b) => b.createdAt - a.createdAt
  );
}

/**
 * One row per note zapped, not one per payment.
 *
 * A note that does well produces a notification per zap, and they arrive
 * together — so the list a creator most wants to read is the list most likely
 * to be a wall of the same note repeated twenty times, with everything else
 * pushed off the first screen. The zaps are the good news and they were
 * burying it.
 *
 * Merged by what was paid for, keeping the newest as the row: it carries the
 * right timestamp and the most recent comment. The total is what arrived
 * across all of them, and the count is people rather than payments — somebody
 * zapping the same note three times is one person who liked it a lot.
 *
 * Profile zaps are left alone. They have no target to group by, and bucketing
 * every zap somebody ever sent you into one row would collapse a history into
 * a single line.
 */
export function groupZaps(notifications: Notification[]): Notification[] {
  const merged = new Map<string, Notification>();
  const senders = new Map<string, Set<string>>();

  for (const notification of notifications) {
    if (notification.type !== 'zap' || !notification.targetEventId) continue;

    const key = notification.targetEventId;
    const held = merged.get(key);

    const people = senders.get(key) ?? new Set<string>();
    people.add(notification.pubkey);
    senders.set(key, people);

    const sats = (held?.totalSats ?? 0) + (notification.amountSats ?? 0);

    /*
     * The newest wins the row, so the timestamp and the comment shown are the
     * most recent — but the total has to survive whichever way round they
     * arrive, which is why it is carried rather than recomputed.
     */
    const row =
      !held || notification.createdAt > held.createdAt ? notification : held;

    merged.set(key, { ...row, totalSats: sats });
  }

  const taken = new Set<string>();

  return notifications.flatMap((notification) => {
    if (notification.type !== 'zap' || !notification.targetEventId) {
      return [notification];
    }

    const key = notification.targetEventId;
    if (taken.has(key)) return [];
    taken.add(key);

    const row = merged.get(key)!;
    const count = senders.get(key)?.size ?? 1;

    return [{ ...row, zapperCount: count }];
  });
}

/**
 * One row per follower, however many contact lists of theirs came back.
 *
 * Kind 3 is replaceable, and people edit their follows — so the same person
 * appears once per version a relay still holds, and paginating turns up older
 * ones as you scroll. Without this a single reader who reorganises their
 * following list fills your notifications with themselves.
 *
 * The newest is kept, which is also the one whose timestamp is closest to
 * meaning anything. It still is not the moment they followed you — nothing on
 * Nostr records that — it is when they last published the list you are in.
 */
export function collapseFollows(notifications: Notification[]): Notification[] {
  const newest = new Map<string, number>();

  for (const notification of notifications) {
    if (notification.type !== 'follow') continue;

    const held = newest.get(notification.pubkey);
    if (held === undefined || notification.createdAt > held) {
      newest.set(notification.pubkey, notification.createdAt);
    }
  }

  const taken = new Set<string>();

  return notifications.filter((notification) => {
    if (notification.type !== 'follow') return true;
    if (taken.has(notification.pubkey)) return false;
    if (newest.get(notification.pubkey) !== notification.createdAt) return false;

    // Two lists sharing a timestamp would otherwise both survive the check above
    taken.add(notification.pubkey);
    return true;
  });
}

export const NOTIFICATION_FILTERS = [
  { value: 'all', label: 'All', types: null },
  { value: 'mentions', label: 'Mentions', types: ['mention', 'reply', 'quote'] },
  { value: 'reactions', label: 'Reactions', types: ['reaction'] },
  { value: 'reposts', label: 'Reposts', types: ['repost'] },
  { value: 'zaps', label: 'Zaps', types: ['zap'] },
  { value: 'follows', label: 'Follows', types: ['follow'] },
] as const satisfies readonly {
  value: string;
  label: string;
  types: readonly NotificationType[] | null;
}[];

export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number]['value'];

export function filterNotifications(
  notifications: Notification[],
  filter: NotificationFilter
): Notification[] {
  const types = NOTIFICATION_FILTERS.find(
    (entry) => entry.value === filter
  )?.types;

  if (!types) return notifications;
  return notifications.filter((notification) =>
    (types as readonly NotificationType[]).includes(notification.type)
  );
}
