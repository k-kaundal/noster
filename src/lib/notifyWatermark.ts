/**
 * How far the announcements have got.
 *
 * A system notification is the one thing this app does that interrupts
 * somebody who is not looking at it, so announcing the same zap twice is worse
 * than a rendering bug by a wide margin — it trains people to turn the feature
 * off, and they are right to.
 *
 * The mark used to live in a ref, which meant it was rebuilt from scratch on
 * every load and lost on every reload. Rebuilding it looked safe: seed from
 * the newest item on screen, announce only what arrives after. It is not safe,
 * because the newest item on screen a second after launch is the newest item
 * *one fast relay* had. The seed lands below things that were already
 * announced in an earlier session, and the next refetch — sixty seconds later,
 * reaching more relays — finds them sitting above the mark and announces them
 * all over again. Hours later, on the next launch, it happens again.
 *
 * Two things fix it, and both are needed. The mark is written to storage, so
 * it survives the reload rather than being guessed. And nothing older than
 * `MAX_ANNOUNCE_AGE_MS` is ever announced whatever the mark says, because a
 * watermark can only be as good as the data it was built from and a late
 * arrival from a slow relay is not news.
 */

export interface Watermark {
  /**
   * Whose notifications this counts.
   *
   * Stored alongside the timestamp rather than in the key so that switching
   * accounts is detectable. Inheriting the previous account's mark would
   * silence a new one until it happened to receive something newer.
   */
  pubkey: string;
  /** Seconds since the epoch, matching `created_at`. Nothing at or below is news. */
  through: number;
}

export const ANNOUNCED_KEY = 'nostr:announced-through';

export const EMPTY_WATERMARK: Watermark = { pubkey: '', through: 0 };

/**
 * The age past which an unannounced item is history rather than news.
 *
 * Six hours is long enough to cover a phone that was asleep overnight and
 * short enough that nothing from last week can arrive as an interruption.
 */
export const MAX_ANNOUNCE_AGE_MS = 6 * 60 * 60 * 1000;

/** The stored mark if it belongs to this account, otherwise nothing. */
export function watermarkFor(
  stored: Watermark | undefined,
  pubkey: string
): Watermark | null {
  if (!pubkey || !stored || stored.pubkey !== pubkey) return null;
  if (typeof stored.through !== 'number' || !Number.isFinite(stored.through)) {
    return null;
  }

  return stored;
}

/**
 * Whether an item is recent enough to interrupt somebody over.
 *
 * The floor is absolute and is checked even for items above the mark. It is
 * the backstop for every way a watermark can be wrong — a partial first page,
 * a cleared storage, a relay serving something with a timestamp from the
 * future — none of which should be able to produce a notification about a
 * conversation that finished days ago.
 */
export function isRecentEnough(
  createdAt: number,
  nowMs = Date.now(),
  maxAgeMs = MAX_ANNOUNCE_AGE_MS
): boolean {
  return createdAt * 1000 >= nowMs - maxAgeMs;
}

/** The items worth announcing: above the mark, and actually recent. */
export function newsFrom<T extends { createdAt: number }>(
  items: readonly T[],
  watermark: Watermark,
  nowMs = Date.now(),
  maxAgeMs = MAX_ANNOUNCE_AGE_MS
): T[] {
  return items.filter(
    (item) =>
      item.createdAt > watermark.through &&
      isRecentEnough(item.createdAt, nowMs, maxAgeMs)
  );
}

/**
 * Moves the mark up to cover everything currently visible.
 *
 * Never backwards. A refetch that returns less than the last one is the normal
 * case here, not an exception, and letting the mark follow it down would
 * re-announce the difference on the way back up.
 */
export function advanced<T extends { createdAt: number }>(
  watermark: Watermark,
  items: readonly T[],
  pubkey: string
): Watermark {
  const newest = items.reduce(
    (highest, item) => Math.max(highest, item.createdAt),
    watermark.pubkey === pubkey ? watermark.through : 0
  );

  return { pubkey, through: newest };
}
