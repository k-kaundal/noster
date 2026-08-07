import type { NostrEvent } from '@nostrify/nostrify';

/** NIP-51 mute list. */
export const MUTE_LIST_KIND = 10000;

export interface MuteList {
  /** Pubkeys whose events are hidden entirely. */
  pubkeys: string[];
  /** Hashtags, stored lowercase and without the leading `#`. */
  hashtags: string[];
  /** Words, stored lowercase. */
  words: string[];
  /** Threads, by root event id. */
  threads: string[];
}

export const EMPTY_MUTE_LIST: MuteList = {
  pubkeys: [],
  hashtags: [],
  words: [],
  threads: [],
};

/** Reads a kind 10000 event into a mute list. */
export function parseMuteList(event: NostrEvent | undefined): MuteList {
  if (!event) return EMPTY_MUTE_LIST;

  const collect = (name: string) =>
    event.tags
      .filter(([tagName]) => tagName === name)
      .map(([, value]) => value)
      .filter(Boolean);

  return {
    pubkeys: collect('p'),
    hashtags: collect('t').map((tag) => tag.replace(/^#/, '').toLowerCase()),
    words: collect('word').map((word) => word.toLowerCase()),
    threads: collect('e'),
  };
}

/** Builds the tags for a mute list event. */
export function buildMuteListTags(list: MuteList): string[][] {
  return [
    ...list.pubkeys.map((pubkey) => ['p', pubkey]),
    ...list.hashtags.map((tag) => ['t', tag.replace(/^#/, '').toLowerCase()]),
    ...list.words.map((word) => ['word', word.toLowerCase()]),
    ...list.threads.map((id) => ['e', id]),
  ];
}

/**
 * Escapes a string for safe use inside a regular expression, so a muted word
 * containing punctuation can't alter the pattern's meaning.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `text` contains `word` as a whole word.
 *
 * Substring matching would be wrong in a way users notice immediately: muting
 * "art" would also hide "start", "party" and "smart". Unicode letter and
 * number classes are used for the boundary so non-English words behave too.
 */
export function containsWord(text: string, word: string): boolean {
  const needle = word.trim().toLowerCase();
  if (!needle) return false;

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`,
    'iu'
  );
  return pattern.test(text);
}

/** The reason an event is hidden, or null when it should be shown. */
export type MuteReason = 'author' | 'hashtag' | 'word' | 'thread' | null;

/**
 * Decides whether an event is muted, and why. Returning the reason lets the UI
 * explain the gap instead of silently dropping content.
 */
export function getMuteReason(
  event: NostrEvent,
  list: MuteList
): MuteReason {
  if (list.pubkeys.includes(event.pubkey)) return 'author';

  if (list.threads.length) {
    const referenced = event.tags
      .filter(([name]) => name === 'e')
      .map(([, id]) => id);
    if (referenced.some((id) => list.threads.includes(id))) return 'thread';
    if (list.threads.includes(event.id)) return 'thread';
  }

  if (list.hashtags.length) {
    const tagged = event.tags
      .filter(([name]) => name === 't')
      .map(([, value]) => value?.toLowerCase())
      .filter(Boolean);

    if (tagged.some((tag) => list.hashtags.includes(tag))) return 'hashtag';

    // Hashtags written inline aren't always mirrored into `t` tags
    if (
      list.hashtags.some((tag) => containsWord(event.content, `#${tag}`)) ||
      list.hashtags.some((tag) => containsWord(event.content, tag))
    ) {
      return 'hashtag';
    }
  }

  if (list.words.some((word) => containsWord(event.content, word))) {
    return 'word';
  }

  return null;
}

export function isMuted(event: NostrEvent, list: MuteList): boolean {
  return getMuteReason(event, list) !== null;
}

/** Removes muted events from a list. */
export function filterMuted<T extends NostrEvent>(
  events: T[],
  list: MuteList
): T[] {
  if (
    !list.pubkeys.length &&
    !list.hashtags.length &&
    !list.words.length &&
    !list.threads.length
  ) {
    return events;
  }
  return events.filter((event) => !isMuted(event, list));
}
