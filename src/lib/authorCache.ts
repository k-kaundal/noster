import type { NostrEvent } from '@nostrify/nostrify';

/**
 * When a cached profile may be replaced.
 *
 * Both rules here exist because a profile has two sources that disagree — the
 * relays, and the event the user just signed — and the naive "last write wins"
 * lost to whichever answered last. On a new account that was reliably the
 * wrong one: the app reads a profile the moment someone logs in, gets nothing
 * because they have not published yet, caches the nothing for half an hour,
 * and then their signup profile lands somewhere the screen never looks.
 *
 * Kept apart from the hook so it can be tested directly. The types here are
 * type-only imports, erased at build time.
 */

export interface CachedAuthor<Metadata = unknown> {
  event?: NostrEvent;
  metadata?: Metadata;
}

/**
 * Whether an event should replace the cached profile.
 *
 * Replaceable events are last-write-wins by `created_at` (NIP-01), so an older
 * one arriving late — a slow relay, a second device catching up, a replayed
 * publish — must not roll the profile backwards.
 *
 * Equal timestamps replace. Two kind 0s in the same second are almost always
 * the same person saving twice, and the later arrival is the later intent;
 * refusing it would drop an edit made within a second of the previous one.
 */
export function shouldReplaceProfile(
  incoming: NostrEvent,
  existing: NostrEvent | undefined
): boolean {
  if (!existing) return true;
  return incoming.created_at >= existing.created_at;
}

/**
 * Reconciles a fetch result with what is already known.
 *
 * An empty result means "this relay has no kind 0 for that key", which is
 * equally what a relay says when it has not indexed one yet, when it timed
 * out, and when the user has just switched to it. Treating that as "they have
 * no profile" is what makes a name and avatar vanish mid-session, and what
 * would otherwise wipe a profile seeded seconds earlier from a signed event
 * the relays have not caught up with.
 *
 * Nothing is lost by keeping the old value: a real profile change arrives as
 * an event, and an event always replaces.
 */
export function reconcileAuthor<T extends CachedAuthor>(
  fetched: T,
  existing: T | undefined
): T {
  if (fetched.event) return fetched;
  if (existing?.event) return existing;
  return fetched;
}
