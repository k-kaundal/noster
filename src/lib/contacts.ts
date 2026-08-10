import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Reading and rewriting a contact list (kind 3) without losing anyone.
 *
 * Kept apart from the hook because this is the one place in the app where a
 * misread destroys data rather than displaying it wrong. Following one person
 * republishes the entire list, so whichever revision is read becomes the
 * revision everyone gets — and the wrong choice deletes every follow the
 * chosen copy did not know about.
 */

/**
 * The newest revision out of everything the relays returned.
 *
 * Kind 3 is replaceable, so each relay serves whichever revision it last saw.
 * A relay that was unreachable when someone followed fifty people still hands
 * back the list from before, and the pool merges them into one array in no
 * meaningful order. Taking the first is taking a revision at random.
 */
export function latestContactList(
  events: Array<NostrEvent | undefined>
): NostrEvent | undefined {
  return events.reduce<NostrEvent | undefined>((newest, event) => {
    if (!event) return newest;
    return !newest || event.created_at > newest.created_at ? event : newest;
  }, undefined);
}

/** The `p` tags of a contact list, in the order they were written. */
export function contactTags(event: NostrEvent | undefined): string[][] {
  return event?.tags.filter((tag) => tag[0] === 'p' && !!tag[1]) ?? [];
}

/**
 * The tags for a revised contact list.
 *
 * Existing entries are carried through untouched — the relay hint and petname
 * in positions two and three belong to whoever wrote them, and rebuilding a
 * tag as `['p', pubkey]` would quietly discard both.
 */
export function reviseContacts(
  existing: string[][],
  { add = [], remove = [] }: { add?: string[]; remove?: string[] }
): string[][] {
  const dropped = new Set(remove);

  const kept = existing.filter((tag) => !dropped.has(tag[1]));
  const known = new Set(kept.map((tag) => tag[1]));

  const added = add
    .filter((pubkey) => !known.has(pubkey) && !dropped.has(pubkey))
    // Deduplicated against itself as well: following a list twice in one call
    // would otherwise write the same person in twice
    .filter((pubkey, index, all) => all.indexOf(pubkey) === index)
    .map((pubkey) => ['p', pubkey]);

  return [...kept, ...added];
}
