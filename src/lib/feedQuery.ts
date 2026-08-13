/**
 * How a feed is addressed and filtered.
 *
 * Split out of the hook so it can be reasoned about — and tested — without a
 * relay pool, a query client or a component tree. What a feed asks for and
 * where the answer is filed are decisions worth being able to check on their
 * own; the hook around them is plumbing.
 */
import type { NostrFilter } from '@nostrify/nostrify';
import { TIMELINE_KINDS } from '@/lib/eventKinds';

export type FeedScope = 'global' | 'following';

/** Most authors a relay will accept in one filter without refusing it. */
export const MAX_AUTHORS = 500;

/**
 * What identifies a feed in the cache.
 *
 * Keyed on *whose* feed it is, not on the size of their follow list. It used
 * to include `authors.length`, which meant following one more person produced
 * a key nothing had ever been fetched for — so the timeline somebody was
 * reading emptied to a skeleton and refilled from scratch, as though they had
 * arrived for the first time. The follow list still decides what is fetched;
 * it just no longer decides where the answer is filed.
 *
 * The global feed is the same for everybody, so it is deliberately shared
 * rather than kept per reader — one copy in the cache, warm for whoever
 * arrives next.
 */
export function feedQueryKey(
  scope: FeedScope,
  pubkey: string | undefined
): readonly unknown[] {
  return ['feed', scope, scope === 'following' ? pubkey ?? '' : ''];
}

export function feedFilter(scope: FeedScope, authors: string[]): NostrFilter {
  return {
    kinds: TIMELINE_KINDS,
    // Relays index authors, so following feeds filter server-side
    ...(scope === 'following' ? { authors: authors.slice(0, MAX_AUTHORS) } : {}),
  };
}
