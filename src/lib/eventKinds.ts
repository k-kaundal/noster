import type { NostrEvent } from '@nostrify/nostrify';

/** How a note's body should be rendered. */
export type NoteRenderKind =
  | 'text'
  | 'repost'
  | 'article'
  | 'video'
  | 'picture'
  | 'structured'
  | 'poll'
  | 'unknown';

/** Human-readable labels for the kinds this client is likely to encounter. */
const KIND_LABELS: Record<number, string> = {
  0: 'Profile metadata',
  1: 'Note',
  3: 'Contact list',
  4: 'Encrypted message',
  5: 'Deletion request',
  6: 'Repost',
  7: 'Reaction',
  16: 'Generic repost',
  20: 'Picture post',
  21: 'Video',
  22: 'Short video',
  1063: 'File metadata',
  1068: 'Poll',
  1111: 'Comment',
  1984: 'Report',
  9734: 'Zap request',
  9735: 'Zap receipt',
  10000: 'Mute list',
  10002: 'Relay list',
  10003: 'Bookmarks',
  30000: 'Follow set',
  30023: 'Article',
  30024: 'Article draft',
  34235: 'Video',
  34236: 'Short video',
};

/**
 * The NIP-01 storage classes, by kind number.
 *
 * Spelled out rather than imported from Nostrify: these are three
 * comparisons, and importing a runtime value from that package pulls the
 * whole library into everything that needs to ask "is this addressable",
 * including tests that otherwise need no relay stack at all.
 */
export function isAddressableKind(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

export function isReplaceableKind(kind: number): boolean {
  return kind >= 10000 && kind < 20000;
}

/**
 * The `kind:pubkey:d` coordinate of an event that has one.
 *
 * Replaceable events (10000-19999) have one per author and so end in an empty
 * identifier; addressable ones (30000-39999) carry it in their `d` tag.
 * Regular events have no address at all, which is why this returns undefined
 * rather than an empty string — the difference decides whether a reference
 * should be an `a` tag or an `e` tag.
 */
export function addressOf(event: NostrEvent): string | undefined {
  if (isAddressableKind(event.kind)) {
    const d = event.tags.find(([name]) => name === 'd')?.[1] ?? '';
    return `${event.kind}:${event.pubkey}:${d}`;
  }

  if (isReplaceableKind(event.kind)) {
    return `${event.kind}:${event.pubkey}:`;
  }

  return undefined;
}

export function kindLabel(kind: number): string {
  return KIND_LABELS[kind] ?? `Kind ${kind}`;
}

/**
 * NIP-31: a human-readable summary an author attaches so clients that don't
 * understand the kind can still say something useful.
 */
export function getAltText(event: NostrEvent): string | undefined {
  return event.tags.find(([name]) => name === 'alt')?.[1]?.trim() || undefined;
}

/**
 * Parses `content` as a JSON object or array. Many machine-published events
 * (device telemetry, service announcements) put a structured payload here,
 * which reads as gibberish if rendered as prose.
 */
export function parseJsonContent(content: string): unknown | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const looksStructured =
    (first === '{' && last === '}') || (first === '[' && last === ']');
  if (!looksStructured) return null;

  try {
    const parsed = JSON.parse(trimmed);
    // A bare string or number round-trips through JSON.parse but isn't a payload
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

const TEXT_KINDS = new Set([1, 1111]);
const REPOST_KINDS = new Set([6, 16]);

/**
 * Whether an event is a repost rather than something written.
 *
 * Exported because more than the renderer needs it: a repost carries an `e`
 * tag naming what it boosted, which makes it look exactly like a reply to
 * anything testing for one.
 */
export function isRepost(event: { kind: number }): boolean {
  return REPOST_KINDS.has(event.kind);
}
const ARTICLE_KINDS = new Set([30023, 30024]);
const VIDEO_KINDS = new Set([21, 22, 34235, 34236]);
const PICTURE_KINDS = new Set([20]);
const POLL_KINDS = new Set([1068]);

/**
 * Chooses a renderer for an event. Structured JSON wins over the plain-text
 * path even for kind 1, because a note whose whole body is a JSON payload is
 * still unreadable as prose.
 */
export function getNoteRenderKind(event: NostrEvent): NoteRenderKind {
  if (REPOST_KINDS.has(event.kind)) return 'repost';
  if (ARTICLE_KINDS.has(event.kind)) return 'article';
  if (VIDEO_KINDS.has(event.kind)) return 'video';
  if (PICTURE_KINDS.has(event.kind)) return 'picture';
  if (POLL_KINDS.has(event.kind)) return 'poll';

  if (parseJsonContent(event.content)) return 'structured';
  if (TEXT_KINDS.has(event.kind)) return 'text';

  return 'unknown';
}

/** Formats a scalar for the key/value grid of a structured payload. */
export function formatScalar(value: unknown): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';

  if (typeof value === 'number') {
    // Values that look like millisecond epochs read better as a date
    if (Number.isInteger(value) && value > 1_000_000_000_000 && value < 4_000_000_000_000) {
      return new Date(value).toLocaleString();
    }
    if (Number.isInteger(value) && value > 1_000_000_000 && value < 4_000_000_000) {
      return new Date(value * 1000).toLocaleString();
    }
    return Number.isInteger(value) ? value.toLocaleString() : String(value);
  }

  return String(value);
}

/**
 * Turns `memUsedMb` / `host_platform` into `Mem used mb` / `Host platform`.
 * Sentence case matches the labels used elsewhere in the UI, and all-caps
 * words are left alone so acronyms like `ID` or `URL` survive.
 */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()
    );

  if (!words.length) return '';

  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/**
 * True when an event carries nothing this client could show: no body text, no
 * media, and no NIP-31 fallback. Such notes render as an empty card, so the
 * feed filters them out rather than leaving holes in the timeline.
 */
/**
 * What a timeline is made of.
 *
 * One list, shared by the home feed, a profile's notes and the hashtag feed,
 * because they had drifted: the home feed asked for polls and articles and a
 * profile did not, so someone's own poll appeared in everybody's feed and was
 * missing from their own page. Three separate literals is three chances for
 * that to happen again the next time a kind is added.
 *
 * 1 and 1068 are notes and NIP-88 polls; 6 and 16 are the two kinds of
 * repost; 30023 is a NIP-23 article.
 */
export const TIMELINE_KINDS = [1, 6, 16, 1068, 30023];

export function isRenderableEvent(event: NostrEvent): boolean {
  if (event.content.trim()) return true;
  if (getAltText(event)) return true;

  // Media-bearing kinds keep their payload in tags, not in content
  return event.tags.some(
    ([name]) =>
      name === 'imeta' ||
      name === 'url' ||
      name === 'e' ||
      name === 'title' ||
      name === 'option'
  );
}
