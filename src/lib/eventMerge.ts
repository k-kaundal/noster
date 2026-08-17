import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Combining two partial answers into one better answer.
 *
 * Every read in this app asks several relays at once and takes whatever comes
 * back before the timeout. None of them is authoritative and none of them is
 * complete: one relay has a note another has never seen, a third is asleep,
 * and the set that answers is different every minute.
 *
 * The query library's default is that the newest response replaces the last
 * one, which is right for a database and wrong for this. It means a count is
 * whatever the luckiest subset of relays happened to hold, and it changes on
 * screen every time it refetches — the same follower count reading 180, then
 * 61, then 174, with nothing having happened.
 *
 * So responses are merged rather than replaced. What is here is what any relay
 * has ever told us, which is never worse than what the last one said.
 */

/** NIP-01: only the newest event per kind and author is kept. */
export function isReplaceable(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
}

/** NIP-01: newest per kind, author and `d` tag. */
export function isAddressable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

/** NIP-01: "relays SHOULD NOT store" these at all, and neither do we. */
export function isEphemeral(kind: number): boolean {
  return kind >= 20000 && kind < 30000;
}

/**
 * What makes two events the same record.
 *
 * The reason a follower count could exceed the number of followers: a contact
 * list is replaceable, so one person's list exists as several events with
 * different ids, and relays disagree about which revision they hold. Counting
 * events counted the same person once per revision that reached us. Counting
 * record keys counts people.
 */
export function recordKey(event: NostrEvent): string {
  if (isReplaceable(event.kind)) return `${event.kind}:${event.pubkey}`;

  if (isAddressable(event.kind)) {
    const identifier = event.tags.find(([name]) => name === 'd')?.[1] ?? '';
    return `${event.kind}:${event.pubkey}:${identifier}`;
  }

  return event.id;
}

/**
 * Whether one revision of a record should displace another.
 *
 * NIP-01 settles the tie for us — "the event with the lowest id ... is kept" —
 * which matters more than it sounds. Two relays holding equally-timestamped
 * revisions must resolve to the same winner on every device, or a follow made
 * on a phone disagrees with the same follow read on a laptop forever.
 */
export function supersedes(candidate: NostrEvent, incumbent: NostrEvent): boolean {
  if (candidate.created_at !== incumbent.created_at) {
    return candidate.created_at > incumbent.created_at;
  }

  return candidate.id < incumbent.id;
}

/**
 * Everything either side knows, newest first.
 *
 * `cap` is a memory bound, not a page size. It applies after merging so the
 * newest `cap` records survive rather than whichever arrived first — dropping
 * an event we already had in favour of an older one would be a cache that
 * gets worse the more it is used.
 */
export function mergeEvents(
  existing: readonly NostrEvent[],
  incoming: readonly NostrEvent[],
  cap = 2000
): NostrEvent[] {
  const byRecord = new Map<string, NostrEvent>();

  for (const event of [...existing, ...incoming]) {
    if (isEphemeral(event.kind)) continue;

    const key = recordKey(event);
    const held = byRecord.get(key);

    if (!held || supersedes(event, held)) byRecord.set(key, event);
  }

  const merged = [...byRecord.values()].sort((a, b) => {
    if (a.created_at !== b.created_at) return b.created_at - a.created_at;
    // Stable regardless of the order relays answered in, so two devices with
    // the same events render the same list
    return a.id < b.id ? -1 : 1;
  });

  return cap > 0 && merged.length > cap ? merged.slice(0, cap) : merged;
}

/** How many distinct people are represented, rather than how many events. */
export function uniqueAuthors(events: readonly NostrEvent[]): string[] {
  return [...new Set(events.map((event) => event.pubkey))];
}
