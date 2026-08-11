import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-84: highlights — a passage somebody thought was worth keeping.
 *
 * The subtlety is in the tags rather than the content. A highlight carries the
 * quoted text in `.content` and points at where it came from, and when it also
 * carries a `comment` it becomes a quote highlight: one event that renders as
 * a quote repost, instead of the highlight-plus-kind-1 pair that would
 * otherwise appear twice in a row in every microblogging client.
 *
 * That doubling-up is what the attribute rules exist for. Once a comment can
 * mention people and link to things, a reader has no way to tell the author of
 * the highlighted material from somebody the commenter name-dropped, or the
 * source URL from a link in the remark — unless the roles are written down.
 * The spec makes that a MUST; this module is where it is kept.
 */

export const HIGHLIGHT_KIND = 9802;

/**
 * Query parameters that identify a reader rather than a document.
 *
 * "Clients generating these events SHOULD do a best effort of cleaning the URL
 * from trackers" — which matters more here than usual, because a highlight is
 * published. A campaign id pasted from someone's mail client would otherwise
 * be signed, broadcast, and attached to a passage forever.
 */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'utm_reader',
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'twclid',
  'ttclid',
  'yclid',
  'igshid',
  'igsh',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'vero_id',
  'oly_anon_id',
  'oly_enc_id',
  'epik',
  '_ga',
  '_gl',
  'ref_src',
  'ref_url',
  'trk',
  'trkcampaign',
  'spm',
  'scm',
]);

/**
 * Parameters that are trackers on some hosts and content on others.
 *
 * `si` is a share id on YouTube and Spotify and a legitimate parameter
 * elsewhere; `s` and `t` are tracking on Twitter and a search box almost
 * everywhere else. Stripping them globally would break links, so they are
 * scoped to the hosts where the meaning is known.
 */
const HOST_SCOPED: { hosts: RegExp; params: string[] }[] = [
  { hosts: /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/i, params: ['si'] },
  { hosts: /(^|\.)(twitter\.com|x\.com)$/i, params: ['s', 't'] },
];

/**
 * A URL fit to publish.
 *
 * Returns the input unchanged when it cannot be parsed. A highlight of
 * something is worth more than a highlight of nothing, and refusing to record
 * a source because its URL is unusual would lose the reference entirely.
 */
export function cleanSourceUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return trimmed;

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  for (const rule of HOST_SCOPED) {
    if (!rule.hosts.test(url.hostname)) continue;
    for (const key of rule.params) url.searchParams.delete(key);
  }

  /**
   * `toString` leaves a bare `?` when the last parameter goes, which is a
   * different string from the clean URL and would have two highlights of the
   * same page disagree about where they came from.
   */
  return url.toString().replace(/\?(?=#|$)/, '');
}

export type AttributionRole = 'author' | 'editor' | 'mention';

export interface HighlightPerson {
  pubkey: string;
  relay?: string;
  /** `author`/`editor` for the source; `mention` for the comment. */
  role: AttributionRole;
}

export interface Highlight {
  /** The highlighted passage. Empty for highlights of audio or video. */
  content: string;
  /** Where it came from, cleaned. */
  sourceUrl?: string;
  /** A nostr event it came from — `e` for regular, `a` for addressable. */
  sourceEventId?: string;
  sourceAddress?: string;
  /** Surrounding text, when the highlight is a fragment of a paragraph. */
  context?: string;
  /** Present on a quote highlight, which renders as a quote repost. */
  comment?: string;
  /** Everyone credited for the material itself. */
  attribution: HighlightPerson[];
  /** People named in the comment, which is a different thing entirely. */
  mentions: HighlightPerson[];
  /** URLs from the comment, as opposed to the source. */
  mentionedUrls: string[];
  event: NostrEvent;
}

function firstValue(event: NostrEvent, name: string): string | undefined {
  const value = event.tags.find(([key]) => key === name)?.[1]?.trim();
  return value || undefined;
}

export function isQuoteHighlight(event: NostrEvent): boolean {
  return !!firstValue(event, 'comment');
}

export function parseHighlight(event: NostrEvent): Highlight | null {
  if (event.kind !== HIGHLIGHT_KIND) return null;

  const people: HighlightPerson[] = [];

  for (const [name, pubkey, relay, role] of event.tags) {
    if (name !== 'p' || !pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) continue;

    const marker = role?.trim().toLowerCase();

    people.push({
      pubkey,
      relay: relay?.trim() || undefined,
      /**
       * Unmarked `p` tags default to `author`. The role is optional in the
       * base spec and only becomes a MUST once a comment can mention people,
       * so an older highlight with a bare `p` means the person it came from.
       */
      role:
        marker === 'mention' || marker === 'editor'
          ? (marker as AttributionRole)
          : 'author',
    });
  }

  /**
   * `r` tags split by their attribute. An unmarked one is read as the source,
   * because that is what it meant before the attribute existed — being liberal
   * here costs nothing, while treating an old highlight's source as a passing
   * mention would lose the only pointer it has.
   */
  const sourceUrls: string[] = [];
  const mentionedUrls: string[] = [];

  for (const [name, url, attribute] of event.tags) {
    if (name !== 'r' || !url?.trim()) continue;

    if (attribute?.trim().toLowerCase() === 'mention') {
      mentionedUrls.push(url.trim());
    } else {
      sourceUrls.push(url.trim());
    }
  }

  return {
    content: event.content,
    sourceUrl: sourceUrls[0],
    sourceEventId: firstValue(event, 'e'),
    sourceAddress: firstValue(event, 'a'),
    context: firstValue(event, 'context'),
    comment: firstValue(event, 'comment'),
    attribution: people.filter((person) => person.role !== 'mention'),
    mentions: people.filter((person) => person.role === 'mention'),
    mentionedUrls,
    event,
  };
}

export interface HighlightInput {
  /** The highlighted passage. */
  content: string;
  /** The paragraph it sits in, when the highlight is only part of one. */
  context?: string;
  /** Turns this into a quote highlight, rendered as a quote repost. */
  comment?: string;
  /** Cleaned before it is written. */
  sourceUrl?: string;
  sourceEventId?: string;
  sourceAddress?: string;
  /** Who wrote or edited the material. */
  attribution?: HighlightPerson[];
  /** People named in the comment. */
  mentions?: { pubkey: string; relay?: string }[];
  /** URLs appearing in the comment. */
  mentionedUrls?: string[];
}

/**
 * The tags for a kind 9802.
 *
 * Roles are written on every `p` and `r` tag, not only when a comment makes
 * them mandatory. The distinction the spec is protecting — who wrote this
 * versus who was name-dropped about it — is worth just as much on a highlight
 * with no comment, and a reader should not have to know whether a comment was
 * present to know what a tag means.
 */
export function buildHighlightTags(input: HighlightInput): string[][] {
  const tags: string[][] = [];

  if (input.sourceAddress) {
    tags.push(['a', input.sourceAddress]);
  } else if (input.sourceEventId) {
    tags.push(['e', input.sourceEventId]);
  }

  const source = input.sourceUrl ? cleanSourceUrl(input.sourceUrl) : '';
  if (source) tags.push(['r', source, 'source']);

  for (const person of input.attribution ?? []) {
    tags.push(['p', person.pubkey, person.relay ?? '', person.role]);
  }

  if (input.context?.trim()) tags.push(['context', input.context.trim()]);

  const comment = input.comment?.trim();
  if (comment) {
    tags.push(['comment', comment]);

    // Only meaningful alongside a comment: these describe what is in it
    for (const person of input.mentions ?? []) {
      tags.push(['p', person.pubkey, person.relay ?? '', 'mention']);
    }

    for (const url of input.mentionedUrls ?? []) {
      const cleaned = cleanSourceUrl(url);
      if (cleaned && cleaned !== source) tags.push(['r', cleaned, 'mention']);
    }
  }

  return tags;
}

/**
 * Filters for finding the highlights of something.
 *
 * An addressable event is highlighted by coordinate, so a highlight of an
 * article survives the author editing it — which is the whole reason
 * addressable events exist and would be lost by matching on event id.
 */
export function highlightFilterFor(
  target: { eventId?: string; address?: string; url?: string },
  limit = 100
): Record<string, unknown>[] {
  const filters: Record<string, unknown>[] = [];

  if (target.address) {
    filters.push({ kinds: [HIGHLIGHT_KIND], '#a': [target.address], limit });
  }

  if (target.eventId) {
    filters.push({ kinds: [HIGHLIGHT_KIND], '#e': [target.eventId], limit });
  }

  if (target.url) {
    filters.push({
      kinds: [HIGHLIGHT_KIND],
      '#r': [cleanSourceUrl(target.url)],
      limit,
    });
  }

  return filters;
}

/**
 * Trims a selection down to something worth publishing.
 *
 * Browsers hand back whatever the drag touched, including the newlines and run
 * of spaces between block elements. Publishing that verbatim gives a highlight
 * that does not match the text anyone else selects from the same paragraph.
 */
export function normaliseSelection(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Longest passage worth carrying as `context`. */
const MAX_CONTEXT = 1000;

export function trimContext(context: string): string | undefined {
  const cleaned = normaliseSelection(context);
  if (!cleaned) return undefined;

  return cleaned.length > MAX_CONTEXT
    ? `${cleaned.slice(0, MAX_CONTEXT)}…`
    : cleaned;
}
