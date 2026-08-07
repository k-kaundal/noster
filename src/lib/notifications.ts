import type { NostrEvent } from '@nostrify/nostrify';
import { parseZapReceipt, ZAP_RECEIPT_KIND } from '@/lib/zap';

export type NotificationType =
  | 'mention'
  | 'reply'
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
  // and its marked "reply"/"root" tag under NIP-10.
  const eTags = event.tags.filter(([name]) => name === 'e');
  if (!eTags.length) return null;

  const reply = eTags.find(([, , , marker]) => marker === 'reply');
  if (reply) return reply[1];

  const root = eTags.find(([, , , marker]) => marker === 'root');
  if (root) return root[1];

  return eTags[eTags.length - 1][1];
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

  const type: NotificationType =
    event.kind === 7
      ? 'reaction'
      : event.kind === 6 || event.kind === 16
        ? 'repost'
        : // A kind 1 that quotes or answers a note is a reply; one that only
          // tags the user in its text is a mention.
          target
          ? 'reply'
          : 'mention';

  return {
    event,
    type,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    targetEventId: target,
    content: event.kind === 7 ? normalizeReaction(event.content) : event.content,
    amountSats: null,
  };
}

/** NIP-25 leaves "+" and "" meaning "like"; show a heart for both. */
export function normalizeReaction(content: string): string {
  const value = content.trim();
  if (!value || value === '+') return '❤️';
  if (value === '-') return '👎';
  return value;
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
  { value: 'mentions', label: 'Mentions', types: ['mention', 'reply'] },
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
