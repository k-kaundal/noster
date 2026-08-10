import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-37 draft wraps.
 *
 * A draft used to be a `kind:30024` event: the same shape as the article, in
 * plaintext, published to public relays. NIP-23 now calls that kind
 * deprecated, and the reason is the obvious one — a relay serves a draft to
 * anyone who asks for it, so "unpublished" meant nothing more than that this
 * app declined to list it. Half-written thoughts, unsent drafts, things
 * deliberately not said yet: all of it readable by anyone who knew to look.
 *
 * A draft wrap is `kind:31234` holding the whole unsigned event, JSON
 * stringified and NIP-44 encrypted to the author's own key. The relay stores
 * a blob it cannot read, and the draft is private in the sense people always
 * assumed it was.
 */

export const DRAFT_WRAP_KIND = 31234;

/**
 * How long a relay is asked to keep a draft.
 *
 * NIP-37 recommends 90 days via a NIP-40 expiration tag. It is a request
 * rather than a guarantee — a relay may ignore it — but the request costs
 * nothing and the alternative is asking relays to hold half-finished writing
 * forever.
 */
export const DRAFT_TTL_DAYS = 90;

/** The unsigned event a draft wraps. */
export interface DraftEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey?: string;
}

export function buildDraftWrapTags(input: {
  identifier: string;
  kind: number;
  now?: number;
  ttlDays?: number;
}): string[][] {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const ttl = (input.ttlDays ?? DRAFT_TTL_DAYS) * 86400;

  return [
    ['d', input.identifier],
    // Required: without it, finding your article drafts means decrypting
    // every draft you have ever saved of any kind to see what it was
    ['k', String(input.kind)],
    ['expiration', String(now + ttl)],
  ];
}

/** What goes in `.content` before encryption. */
export function serializeDraft(draft: DraftEvent): string {
  return JSON.stringify({
    kind: draft.kind,
    content: draft.content,
    tags: draft.tags,
    created_at: draft.created_at,
    ...(draft.pubkey ? { pubkey: draft.pubkey } : {}),
  });
}

/**
 * Reads a decrypted draft back, refusing anything that is not one.
 *
 * The plaintext came out of an encrypted blob written by this account, but it
 * still arrived over a relay, and a wrap whose contents do not parse is far
 * more likely to be a bug or a truncated payload than an event. Returning
 * null lets the caller skip it rather than render a draft with no kind.
 */
export function parseDraft(plaintext: string): DraftEvent | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const draft = parsed as Record<string, unknown>;

  if (typeof draft.kind !== 'number') return null;
  if (typeof draft.content !== 'string') return null;
  if (!Array.isArray(draft.tags)) return null;

  // Tags are arrays of strings; anything else would break every consumer that
  // destructures them, which is all of them
  const tags = draft.tags.filter(
    (tag): tag is string[] =>
      Array.isArray(tag) && tag.every((part) => typeof part === 'string')
  );

  return {
    kind: draft.kind,
    content: draft.content,
    tags,
    created_at:
      typeof draft.created_at === 'number'
        ? draft.created_at
        : Math.floor(Date.now() / 1000),
    ...(typeof draft.pubkey === 'string' ? { pubkey: draft.pubkey } : {}),
  };
}

/**
 * Whether a wrap represents a deleted draft.
 *
 * NIP-37 signals deletion by blanking `.content` rather than by NIP-09,
 * because the event is addressable: publishing an empty one replaces the
 * draft in place, which is the only way to make a relay stop holding it that
 * does not depend on the relay honouring a deletion request.
 */
export function isDeletedDraft(event: NostrEvent): boolean {
  return !event.content.trim();
}

/** The kind a wrap says it holds, or undefined when it does not say. */
export function draftKindOf(event: NostrEvent): number | undefined {
  const value = event.tags.find(([name]) => name === 'k')?.[1];
  const kind = Number(value);

  return value && Number.isInteger(kind) ? kind : undefined;
}

/** The identifier a wrap is addressed by. */
export function draftIdentifierOf(event: NostrEvent): string | undefined {
  return event.tags.find(([name]) => name === 'd')?.[1] || undefined;
}
