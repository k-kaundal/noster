import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-40, expiration timestamps.
 *
 * An `expiration` tag asks relays to stop serving an event after a moment, and
 * asks clients to stop showing it. Both are requests: relays MAY keep the
 * event indefinitely, and anyone who already downloaded it keeps their copy
 * forever. So this is a courtesy about relevance — a notice that stops being
 * true, an offer that closes — and never a privacy control. The UI says so
 * where the choice is made, because the tag's name invites the other reading.
 */

/** Seconds, matching `created_at`. */
export type UnixSeconds = number;

export function nowSeconds(): UnixSeconds {
  return Math.floor(Date.now() / 1000);
}

/**
 * The expiry on an event, or null when it carries none.
 *
 * A tag that is present but unreadable returns null rather than 0. Zero is a
 * real timestamp meaning 1970, so parsing `["expiration", "soon"]` into it
 * would hide the event permanently — the failure mode should be showing
 * something too long, not vanishing someone's post.
 */
export function expirationOf(event: NostrEvent): UnixSeconds | null {
  const raw = event.tags.find(([name]) => name === 'expiration')?.[1];
  if (!raw) return null;

  const seconds = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Whether an event's moment has passed. */
export function isExpired(event: NostrEvent, now: UnixSeconds = nowSeconds()): boolean {
  const expiry = expirationOf(event);
  return expiry !== null && expiry <= now;
}

/**
 * Drops expired events.
 *
 * "SHOULD ignore events that have expired" — and a relay that keeps serving
 * them is not misbehaving, so this has to happen on the way in rather than
 * being left to the relays.
 */
export function withoutExpired<T extends NostrEvent>(
  events: T[],
  now: UnixSeconds = nowSeconds()
): T[] {
  return events.filter((event) => !isExpired(event, now));
}

/** Seconds remaining, floored at zero. */
export function secondsUntilExpiry(
  event: NostrEvent,
  now: UnixSeconds = nowSeconds()
): number | null {
  const expiry = expirationOf(event);
  return expiry === null ? null : Math.max(0, expiry - now);
}

export interface ExpiryChoice {
  id: string;
  label: string;
  /** Null is "no expiry", which is the default and writes no tag. */
  seconds: number | null;
}

export const EXPIRY_CHOICES: ExpiryChoice[] = [
  { id: 'never', label: 'Never', seconds: null },
  { id: '1h', label: '1 hour', seconds: 3600 },
  { id: '6h', label: '6 hours', seconds: 6 * 3600 },
  { id: '1d', label: '1 day', seconds: 86400 },
  { id: '1w', label: '1 week', seconds: 7 * 86400 },
  { id: '30d', label: '30 days', seconds: 30 * 86400 },
];

/**
 * The tag for an event that should expire, or nothing.
 *
 * Takes a duration rather than a timestamp because that is what someone
 * chooses — "an hour from now" — and computing the absolute moment at the
 * point of publishing keeps a composer left open for twenty minutes from
 * publishing something already half expired.
 */
export function expirationTags(
  seconds: number | null | undefined,
  now: UnixSeconds = nowSeconds()
): string[][] {
  if (!seconds || seconds <= 0) return [];
  return [['expiration', String(now + Math.floor(seconds))]];
}

/**
 * How long is left, for a reader.
 *
 * Rounds down and stops at "less than a minute", because the exact second an
 * event stops being served is not knowable from here — the relay decides.
 */
export function formatTimeLeft(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  if (seconds < 60) return 'Less than a minute left';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m left`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h left`;

  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

/** NIP-40's number, for checking a relay's `supported_nips`. */
export const NIP40 = 40;

/**
 * Which of these relays will honour an expiry.
 *
 * "Clients SHOULD NOT send expiration events to relays that do not support
 * this NIP" — the reasoning being that such a relay keeps and serves the
 * event forever, so the author gets a promise that was never kept. Knowing
 * which relays those are needs their NIP-11 documents, and many relays serve
 * those without CORS headers, so an unknown answer is common. Unknown is
 * treated as supporting: refusing to publish because a document could not be
 * fetched would block posting to most of the network.
 */
export function relaysRejectingExpiry(
  relays: { url: string; supportsExpiry: boolean | undefined }[]
): string[] {
  return relays
    .filter((relay) => relay.supportsExpiry === false)
    .map((relay) => relay.url);
}
