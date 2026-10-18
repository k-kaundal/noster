import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-38 user statuses.
 *
 * A status is a small piece of "what are you doing right now" — the same
 * shape as an AIM away message or a Slack status. It is an addressable event
 * (`kind:30315`) whose `d` tag says what kind of status it is: `general`,
 * `music`, or anything else a client wants to track. Addressable means a
 * person has one status per type at a time; publishing another replaces it.
 *
 * The event carries no body of its own worth indexing. What matters is the
 * tag set: a free-text `content`, an optional `r` URL pointing at what the
 * status is about (the track, the article, the stream), and an `expiration`
 * tag that says when to stop showing it. Without an expiry the status is
 * shown until the author changes it, which is why the default here is short
 * enough that forgetting to clear it does not leave "At lunch" up for a week.
 */

/** NIP-38 user status. Addressable per author and `d`. */
export const USER_STATUS_KIND = 30315;

/**
 * How long a status with no `expiration` tag is still believed.
 *
 * The spec makes expiry optional, which means plenty of statuses have none.
 * Without a cutoff the profile header fills with messages whose authors
 * forgot they ever set them. Six hours is long enough to mean "this is still
 * what I am doing" and short enough that "listening to" is not still up the
 * next morning.
 */
export const STATUS_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** The two types the spec defines. Anything else is accepted but not iconified. */
export type StatusType = 'general' | 'music' | string;

export interface UserStatus {
  event: NostrEvent;
  /** `30315:<pubkey>:<d>`. */
  address: string;
  /** The `d` tag — `general`, `music`, or a custom type. */
  type: StatusType;
  author: string;
  /** Free text, often with emoji. Empty content means the author cleared it. */
  content: string;
  /** What the status is about, when there is a link. */
  reference?: string;
  /** Unix seconds, when the author set an expiry. */
  expiresAt?: number;
  /**
   * Buzz-style plain status emoji: `["emoji", "🎉"]`.
   *
   * Two elements, separate from NIP-30 custom emojis (three or more). This is
   * what enables emoji-only statuses: blank content plus this tag still reads
   * as a live status rather than a cleared one.
   */
  statusEmoji?: string;
}

const tagValue = (event: NostrEvent, name: string): string | undefined =>
  event.tags.find(([tagName]) => tagName === name)?.[1] || undefined;

function readExpiration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Reads the Buzz-style plain status emoji, if there is one.
 *
 * Distinguished from NIP-30 custom emojis by length: exactly two elements is
 * a plain emoji, three or more is a custom emoji with a URL. The two shapes
 * never overlap.
 */
function readStatusEmoji(event: NostrEvent): string | undefined {
  return event.tags.find(
    ([name, value, url]) => name === 'emoji' && !!value && !url
  )?.[1];
}

/** Reads a kind 30315, or null when it is not one worth showing. */
export function parseUserStatus(event: NostrEvent): UserStatus | null {
  if (event.kind !== USER_STATUS_KIND) return null;

  const type = tagValue(event, 'd');
  if (!type) return null;

  return {
    event,
    address: `${USER_STATUS_KIND}:${event.pubkey}:${type}`,
    type,
    author: event.pubkey,
    content: event.content,
    reference: tagValue(event, 'r'),
    expiresAt: readExpiration(tagValue(event, 'expiration')),
    statusEmoji: readStatusEmoji(event),
  };
}

/**
 * Whether a status has been cleared.
 *
 * Blank content with no status emoji is the spec's way of saying "nothing to
 * show". Blank content *with* an emoji is still a live status — the emoji is
 * the whole status.
 */
export function isCleared(status: UserStatus): boolean {
  return !status.content.trim() && !status.statusEmoji;
}

/**
 * Whether a status should be shown right now.
 *
 * Two reasons to hide it: the author set an expiry and it has passed, or the
 * status is older than the staleness window and the author never said when it
 * ends. A cleared status — empty content with no emoji — is also hidden,
 * which is how an author says "nothing to show" without deleting the event.
 */
export function isStatusActive(status: UserStatus, now = Date.now()): boolean {
  if (isCleared(status)) return false;

  if (status.expiresAt && status.expiresAt * 1000 <= now) return false;

  if (!status.expiresAt) {
    const touched = status.event.created_at * 1000;
    if (now - touched > STATUS_STALE_AFTER_MS) return false;
  }

  return true;
}

/**
 * The newest revision of each status per author and type.
 *
 * Addressable, so a person changing their music produces another event at the
 * same `30315:pubkey:music` address — and relays disagree about which they
 * hold, so the same status arrives several times with different content.
 */
export function newestStatuses(events: readonly NostrEvent[]): UserStatus[] {
  const byAddress = new Map<string, UserStatus>();

  for (const event of events) {
    const status = parseUserStatus(event);
    if (!status) continue;

    const held = byAddress.get(status.address);
    if (!held || status.event.created_at > held.event.created_at) {
      byAddress.set(status.address, status);
    }
  }

  return [...byAddress.values()];
}

/** Build the tags for a status publish. */
export function buildStatusTags(input: {
  type: StatusType;
  reference?: string;
  expiresAt?: number;
  statusEmoji?: string;
}): string[][] {
  const tags: string[][] = [['d', input.type]];

  if (input.reference) tags.push(['r', input.reference]);
  if (input.expiresAt) tags.push(['expiration', String(input.expiresAt)]);
  if (input.statusEmoji) tags.push(['emoji', input.statusEmoji]);

  return tags;
}

/**
 * The tags to publish to clear a status — same address, empty content, and
 * only the `d` tag.
 *
 * Stripping everything else avoids leaking a stale URL or reference after the
 * status is gone. Amethyst's `clear()` does exactly this.
 */
export function clearStatusTags(type: StatusType): string[][] {
  return [['d', type]];
}
