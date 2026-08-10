import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

/** Follow sets: categorised groups of people (NIP-51). */
export const FOLLOW_SET_KIND = 30000;
/** Starter packs: a named set of profiles meant to be followed together. */
export const STARTER_PACK_KIND = 39089;

export const LIST_KINDS = [FOLLOW_SET_KIND, STARTER_PACK_KIND];

/**
 * `d` values this app writes to kind 30000 for its own features.
 *
 * Spotlight stores its picks as a follow set, so without this every profile
 * that has ever used it would appear here as an untitled list of one. They are
 * the same kind but not the same thing.
 */
const RESERVED_IDENTIFIERS = ['spotlight'];
const RESERVED_PREFIXES = ['community-spotlight:'];

export interface PeopleList {
  /** `kind:pubkey:d`, unique across relays. */
  address: string;
  identifier: string;
  kind: number;
  title: string;
  description?: string;
  image?: string;
  /** Public members only; private ones are NIP-44 encrypted to the author. */
  people: string[];
  /** Notes and articles some clients attach alongside the people. */
  notes: string[];
  author: string;
  createdAt: number;
  event: NostrEvent;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([key]) => key === name)?.[1] || undefined;
}

function isReserved(identifier: string): boolean {
  return (
    RESERVED_IDENTIFIERS.includes(identifier) ||
    RESERVED_PREFIXES.some((prefix) => identifier.startsWith(prefix))
  );
}

/**
 * Reads a people list, or null when the event is not one worth showing.
 *
 * A set with no public members is dropped from a browse listing rather than
 * rendered empty: it is either entirely private — and unreadable by anyone but
 * its author — or a leftover from a client that wrote the identifier before
 * the contents.
 *
 * Opening one directly is the exception, and what `options` is for. Someone
 * following a link to their own half-built list should see it, not a page
 * telling them it does not exist.
 */
export function parsePeopleList(
  event: NostrEvent,
  options: { allowEmpty?: boolean; allowReserved?: boolean } = {}
): PeopleList | null {
  if (!LIST_KINDS.includes(event.kind)) return null;

  const identifier = tagValue(event, 'd');
  if (!identifier) return null;
  if (!options.allowReserved && isReserved(identifier)) return null;

  const people = event.tags
    .filter(([name, value]) => name === 'p' && /^[0-9a-f]{64}$/i.test(value ?? ''))
    .map(([, pubkey]) => pubkey.toLowerCase());

  if (!people.length && !options.allowEmpty) return null;

  return {
    address: `${event.kind}:${event.pubkey}:${identifier}`,
    identifier,
    kind: event.kind,
    // The identifier is a slug, not a name, but it beats showing "Untitled"
    // for a list whose author simply never set a title
    title: tagValue(event, 'title') || identifier,
    description: tagValue(event, 'description'),
    image: tagValue(event, 'image'),
    // Pinned rather than inferred: a list may tag the same person twice
    people: Array.from(new Set<string>(people)),
    notes: event.tags
      .filter(([name, value]) => (name === 'e' || name === 'a') && !!value)
      .map(([, value]) => value),
    author: event.pubkey,
    createdAt: event.created_at,
    event,
  };
}

/**
 * Newest first, and one entry per address.
 *
 * Sets are addressable, so relays can each hold a different revision of the
 * same list. Keeping the newest avoids showing a list twice with different
 * membership.
 */
export function dedupeLists(lists: PeopleList[]): PeopleList[] {
  const newest = new Map<string, PeopleList>();

  for (const list of lists) {
    const existing = newest.get(list.address);
    if (!existing || list.createdAt > existing.createdAt) {
      newest.set(list.address, list);
    }
  }

  return [...newest.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** A list being written, before it is an event. */
export interface ListDraft {
  /** The `d` tag. Fixed once published — it is half the list's address. */
  identifier: string;
  title: string;
  description?: string;
  image?: string;
  people: string[];
}

/**
 * A stable, readable `d` value for a new list.
 *
 * Readable because it shows up in the naddr and in other clients, and stable
 * because it is the address: renaming a list must not create a second one. The
 * suffix keeps two lists of the same name apart.
 */
export function newListIdentifier(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  const suffix = Math.random().toString(36).slice(2, 8);
  return slug ? `${slug}-${suffix}` : `list-${suffix}`;
}

export function buildListTags(draft: ListDraft): string[][] {
  return [
    ['d', draft.identifier],
    ['title', draft.title.trim()],
    ...(draft.description?.trim()
      ? [['description', draft.description.trim()]]
      : []),
    ...(draft.image?.trim() ? [['image', draft.image.trim()]] : []),
    // Public members. NIP-51 also allows private ones, encrypted into the
    // content — not written here, because a member nobody can see is a
    // different feature and would be silently lost by clients that ignore it.
    ...draft.people.map((pubkey) => ['p', pubkey]),
  ];
}

/**
 * Reads a pubkey out of whatever someone pasted.
 *
 * People copy npubs from one client, hex from another, and `nostr:` prefixed
 * links from a note. Refusing all but one spelling makes adding someone to a
 * list a puzzle rather than a paste.
 */
export function toPubkey(input: string): string | null {
  const value = input.trim().replace(/^nostr:/, '');
  if (!value) return null;

  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();

  try {
    const decoded = nip19.decode(value);

    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    // Not an identifier this app understands
  }

  return null;
}
