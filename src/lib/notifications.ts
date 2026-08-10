import type { NostrEvent } from '@nostrify/nostrify';
import { parseZapReceipt, ZAP_RECEIPT_KIND } from '@/lib/zap';
import { reactionEmoji } from '@/lib/reactions';

export type NotificationType =
  | 'mention'
  | 'reply'
  | 'quote'
  | 'reaction'
  | 'repost'
  | 'zap';

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
}

/** Kinds worth notifying about, in one filter to keep the query count down. */
export const NOTIFICATION_KINDS = [1, 6, 7, 16, ZAP_RECEIPT_KIND];

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
    };
  }

  if (event.pubkey === pubkey) return null;

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

  return notifications.sort((a, b) => b.createdAt - a.createdAt);
}

export const NOTIFICATION_FILTERS = [
  { value: 'all', label: 'All', types: null },
  { value: 'mentions', label: 'Mentions', types: ['mention', 'reply', 'quote'] },
  { value: 'reactions', label: 'Reactions', types: ['reaction'] },
  { value: 'reposts', label: 'Reposts', types: ['repost'] },
  { value: 'zaps', label: 'Zaps', types: ['zap'] },
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
