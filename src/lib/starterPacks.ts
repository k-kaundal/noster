/**
 * Starter packs: one-tap follow lists for people new to Nostr.
 *
 * A starter pack is a kind 39089 follow set, but the job it does is different
 * from a list you keep for yourself. It is the answer to "I just joined, who
 * do I follow" — a curated group someone else already vetted, published so a
 * stranger can follow all of them at once.
 *
 * This lib only handles the pack-specific concerns: parsing, filtering, and
 * the follow-all merge. Generic list handling lives in `lib/lists.ts`.
 */

import { STARTER_PACK_KIND, type PeopleList } from '@/lib/lists';

export { STARTER_PACK_KIND };
export type { PeopleList };

/** Whether a list is a starter pack worth showing in the directory. */
export function isStarterPack(list: PeopleList): boolean {
  return list.kind === STARTER_PACK_KIND;
}

/** Only the starter packs from a mixed list of people lists. */
export function starterPacksOnly(lists: PeopleList[]): PeopleList[] {
  return lists.filter(isStarterPack);
}

/**
 * The pubkeys in a pack that are not already followed.
 *
 * A follow-all that adds everyone again would silently replace the contact
 * list with one that has the same people twice, which relays are entitled to
 * reject as malformed.
 */
export function newFollowsIn(
  pack: PeopleList,
  currentFollows: readonly string[]
): string[] {
  const already = new Set(currentFollows);
  return pack.people.filter((pubkey) => !already.has(pubkey));
}

/**
 * The tags for a kind 3 contact list that adds everyone in a pack.
 *
 * The existing list is kept as it was — content included, which historically
 * carries relay settings this app never displayed — and the new pubkeys are
 * appended. One replaceable event is the whole write; there is no batching
 * to do.
 */
export function mergeFollowAll(
  pack: PeopleList,
  currentFollows: readonly string[],
  currentContent: string
): { tags: string[][]; content: string; added: number } {
  const toAdd = newFollowsIn(pack, currentFollows);

  const tags = [
    ...currentFollows.map((pubkey) => ['p', pubkey] as string[]),
    ...toAdd.map((pubkey) => ['p', pubkey] as string[]),
  ];

  return { tags, content: currentContent, added: toAdd.length };
}
