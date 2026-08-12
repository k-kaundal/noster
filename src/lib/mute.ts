import type { NostrEvent } from '@nostrify/nostrify';

/** NIP-51 mute list. */
export const MUTE_LIST_KIND = 10000;

export interface MutedItem {
  value: string;
  expiry?: number; // Unix timestamp in seconds
  soft?: boolean; // Soft mute: collapse instead of hide
}

export interface MuteList {
  /** Pubkeys whose events are hidden entirely. */
  pubkeys: (string | MutedItem)[];
  /** Hashtags, stored lowercase and without the leading `#`. */
  hashtags: (string | MutedItem)[];
  /** Words, stored lowercase. */
  words: (string | MutedItem)[];
  /** Threads, by root event id. */
  threads: (string | MutedItem)[];
}

export const EMPTY_MUTE_LIST: MuteList = {
  pubkeys: [],
  hashtags: [],
  words: [],
  threads: [],
};

/** Extract value from muted item (string or MutedItem). */
export function getMuteValue(item: string | MutedItem): string {
  return typeof item === 'string' ? item : item.value;
}

/** Check if muted item has expired. */
export function isExpired(item: string | MutedItem): boolean {
  if (typeof item === 'string') return false;
  if (!item.expiry) return false;
  return item.expiry < Math.floor(Date.now() / 1000);
}

/** Reads a kind 10000 event's public tags into a mute list. */
export function parseMuteList(event: NostrEvent | undefined): MuteList {
  if (!event) return EMPTY_MUTE_LIST;
  return parseMuteTags(event.tags);
}

/**
 * Reads mute entries out of a bare tag array.
 *
 * Split out from `parseMuteList` because NIP-51's private items are the same
 * tag array, encrypted into `.content` — so the private half has to be read by
 * exactly the same code, or the two halves would drift and a privately muted
 * word would stop working the moment the public parser learned something new.
 */
export function parseMuteTags(tags: string[][]): MuteList {
  const collect = (name: string) =>
    tags
      .filter(([tagName]) => tagName === name)
      .map(([, value, ...rest]) => {
        // Support: ['p', 'pubkey'] or ['p', 'pubkey', 'expiry', '1692921600'] or ['p', 'pubkey', 'soft-mute']
        const expiry = rest[0] ? parseInt(rest[0]) : undefined;
        const soft = rest.includes('soft-mute');
        const item = { value, expiry: isNaN(expiry as number) ? undefined : expiry, soft };
        return expiry || soft ? item : value;
      })
      .filter(Boolean);

  return {
    pubkeys: collect('p'),
    hashtags: collect('t').map((item) => {
      const value = getMuteValue(item);
      const cleanTag = value.replace(/^#/, '').toLowerCase();
      if (typeof item === 'string') return cleanTag;
      return { ...item, value: cleanTag };
    }),
    words: collect('word').map((item) => {
      const value = getMuteValue(item);
      if (typeof item === 'string') return value.toLowerCase();
      return { ...item, value: value.toLowerCase() };
    }),
    threads: collect('e'),
  };
}

/** Builds the tags for a mute list event. */
export function buildMuteListTags(list: MuteList): string[][] {
  const buildTag = (tagName: string, item: string | MutedItem): string[] => {
    if (typeof item === 'string') {
      return [tagName, item];
    }
    const tag = [tagName, item.value];
    if (item.expiry) tag.push(String(item.expiry));
    if (item.soft) tag.push('soft-mute');
    return tag;
  };

  return [
    ...list.pubkeys.map((p) => buildTag('p', p)),
    ...list.hashtags.map((t) => {
      const value = getMuteValue(t);
      const cleanTag = value.replace(/^#/, '').toLowerCase();
      if (typeof t === 'string') return buildTag('t', cleanTag);
      return buildTag('t', { ...t, value: cleanTag });
    }),
    ...list.words.map((w) => {
      const value = getMuteValue(w);
      const lower = value.toLowerCase();
      if (typeof w === 'string') return buildTag('word', lower);
      return buildTag('word', { ...w, value: lower });
    }),
    ...list.threads.map((e) => buildTag('e', e)),
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

/** Mute reason with optional soft-mute flag. */
export interface MuteReason {
  reason: 'author' | 'hashtag' | 'word' | 'thread' | null;
  soft?: boolean;
}

export function muteReason(
  reason: 'author' | 'hashtag' | 'word' | 'thread' | null,
  soft = false
): MuteReason {
  return { reason, soft };
}

export function isActiveMute(item: string | MutedItem): boolean {
  return !isExpired(item);
}

/**
 * Decides whether an event is muted, and why. Returning the reason lets the UI
 * explain the gap instead of silently dropping content.
 */
export function getMuteReason(
  event: NostrEvent,
  list: MuteList
): MuteReason {
  // Check pubkeys with active mute status
  for (const item of list.pubkeys) {
    const value = getMuteValue(item);
    const isActive = isActiveMute(item);
    if (value === event.pubkey && isActive) {
      const soft = typeof item === 'string' ? false : (item.soft ?? false);
      return muteReason('author', soft);
    }
  }

  if (list.threads.length) {
    const referenced = event.tags
      .filter(([name]) => name === 'e')
      .map(([, id]) => id);
    for (const item of list.threads) {
      const value = getMuteValue(item);
      const isActive = isActiveMute(item);
      if (referenced.includes(value) && isActive) {
        const soft = typeof item === 'string' ? false : (item.soft ?? false);
        return muteReason('thread', soft);
      }
    }
    // Check if the event itself is in the threads list
    for (const item of list.threads) {
      const value = getMuteValue(item);
      const isActive = isActiveMute(item);
      if (value === event.id && isActive) {
        const soft = typeof item === 'string' ? false : (item.soft ?? false);
        return muteReason('thread', soft);
      }
    }
  }

  if (list.hashtags.length) {
    const tagged = event.tags
      .filter(([name]) => name === 't')
      .map(([, value]) => value?.toLowerCase())
      .filter(Boolean);

    for (const item of list.hashtags) {
      const value = getMuteValue(item);
      const isActive = isActiveMute(item);
      if (tagged.includes(value) && isActive) {
        const soft = typeof item === 'string' ? false : (item.soft ?? false);
        return muteReason('hashtag', soft);
      }
    }

    // Hashtags written inline aren't always mirrored into `t` tags
    for (const item of list.hashtags) {
      const value = getMuteValue(item);
      const isActive = isActiveMute(item);
      if (isActive && (
        containsWord(event.content, `#${value}`) ||
        containsWord(event.content, value)
      )) {
        const soft = typeof item === 'string' ? false : (item.soft ?? false);
        return muteReason('hashtag', soft);
      }
    }
  }

  for (const item of list.words) {
    const value = getMuteValue(item);
    const isActive = isActiveMute(item);
    if (isActive && containsWord(event.content, value)) {
      const soft = typeof item === 'string' ? false : (item.soft ?? false);
      return muteReason('word', soft);
    }
  }

  return muteReason(null);
}

export function isMuted(event: NostrEvent, list: MuteList): boolean {
  // `getMuteReason` always returns a MuteReason object — an unmuted event is
  // one whose `reason` is null. Comparing the object itself to null was true
  // for every event, so a single mute entry emptied the whole feed.
  return getMuteReason(event, list).reason !== null;
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

/**
 * Combines the public and private halves of a mute list.
 *
 * Everything that filters a feed wants one answer to "is this muted", and it
 * does not care which half the entry came from. Keeping the halves apart
 * everywhere would mean every call site remembering to check both, and the one
 * that forgot would leak a privately muted account back into somebody's feed.
 */
export function mergeMuteLists(a: MuteList, b: MuteList): MuteList {
  const join = (
    left: (string | MutedItem)[],
    right: (string | MutedItem)[]
  ): (string | MutedItem)[] => {
    const seen = new Set<string>();
    const out: (string | MutedItem)[] = [];

    for (const item of [...left, ...right]) {
      const value = getMuteValue(item);
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(item);
    }

    return out;
  };

  return {
    pubkeys: join(a.pubkeys, b.pubkeys),
    hashtags: join(a.hashtags, b.hashtags),
    words: join(a.words, b.words),
    threads: join(a.threads, b.threads),
  };
}

/** Whether a value appears anywhere in a mute list. */
export function muteListHas(list: MuteList, value: string): boolean {
  return (
    [...list.pubkeys, ...list.hashtags, ...list.words, ...list.threads].some(
      (item) => getMuteValue(item) === value
    )
  );
}
