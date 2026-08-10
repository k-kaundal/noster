/** The `@…` the caret is currently sitting in, if any. */
export interface MentionQuery {
  /** Text typed after the `@`, lowercased. */
  term: string;
  /** Index of the `@` itself. */
  start: number;
  /** Index just past the typed term. */
  end: number;
}

/**
 * Finds the mention being typed at `caret`.
 *
 * The `@` only counts at a word boundary, so an email address or a `user@host`
 * never opens the picker. Whitespace ends the term, which caps how far back
 * this ever scans.
 */
export function findMentionQuery(
  text: string,
  caret: number
): MentionQuery | null {
  if (caret < 0 || caret > text.length) return null;

  // Walk back to the nearest "@", stopping at whitespace
  let index = caret - 1;
  while (index >= 0) {
    const char = text[index];
    if (char === '@') break;
    if (/\s/.test(char)) return null;
    index--;
  }
  if (index < 0) return null;

  const before = index > 0 ? text[index - 1] : '';
  if (before && !/[\s(]/.test(before)) return null;

  const term = text.slice(index + 1, caret);
  // A term with its own "@" is an address being typed, not a mention
  if (term.includes('@')) return null;
  // Long runs are almost certainly a pasted npub, not a name being typed
  if (term.length > 40) return null;

  return { term: term.toLowerCase(), start: index, end: caret };
}

/**
 * Replaces the `@…` under the caret with a `nostr:` URI.
 *
 * Clients read mentions from the URI rather than the display name, so the
 * name typed is discarded — a stale copy of someone's name in the body would
 * outlive their profile changes.
 */
export function applyMention(
  text: string,
  query: MentionQuery,
  nip19Id: string
): { text: string; caret: number } {
  const replacement = `nostr:${nip19Id} `;
  const next = text.slice(0, query.start) + replacement + text.slice(query.end);

  return { text: next, caret: query.start + replacement.length };
}

const NOSTR_URI = /nostr:((?:npub1|nprofile1)[023456789acdefghjklmnpqrstuvwxyz]+)/gi;

/** The identifiers that name an event rather than a person. */
const NOSTR_EVENT_URI =
  /nostr:((?:note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+)/gi;

/**
 * Pubkeys mentioned in a note's body.
 *
 * Relays index `p` tags, and clients build notifications from them, so a
 * mention written only as a `nostr:` URI reaches nobody. These have to be
 * lifted into tags at publish time for the mention to actually arrive.
 */
export function extractMentionPubkeys(
  content: string,
  decode: (value: string) => { type: string; data: unknown }
): string[] {
  const pubkeys = new Set<string>();

  for (const [, uri] of content.matchAll(NOSTR_URI)) {
    try {
      const decoded = decode(uri);
      if (decoded.type === 'npub') {
        pubkeys.add(decoded.data as string);
      } else if (decoded.type === 'nprofile') {
        pubkeys.add((decoded.data as { pubkey: string }).pubkey);
      }
    } catch {
      // A malformed URI is just text; it should not block publishing
    }
  }

  return [...pubkeys];
}

/** Ranks candidates for a typed term, best first. */
export function rankMentions<
  T extends { name?: string; nip05?: string; displayName: string },
>(candidates: T[], term: string, limit = 6): T[] {
  if (!term) return candidates.slice(0, limit);

  const scored: { candidate: T; score: number }[] = [];

  for (const candidate of candidates) {
    const fields = [
      candidate.name?.toLowerCase(),
      candidate.displayName.toLowerCase(),
      candidate.nip05?.toLowerCase(),
    ].filter(Boolean) as string[];

    let best = 0;
    for (const field of fields) {
      // A prefix match is what the typist meant; a substring is a maybe
      if (field.startsWith(term)) best = Math.max(best, 2);
      else if (field.includes(term)) best = Math.max(best, 1);
    }

    if (best > 0) scored.push({ candidate, score: best });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** An event cited in a note's text, ready to become a `q` tag. */
export interface QuotedEvent {
  /** An event id, or a `kind:pubkey:d` address. */
  value: string;
  relay?: string;
  /** The author, which NIP-22 puts in the fourth position of a `q` tag. */
  pubkey?: string;
}

/**
 * Events cited in the content, lifted out for tagging.
 *
 * A quote written only as a `nostr:` URI is invisible to everything except a
 * client rendering that exact text: the quoted author is not notified, and no
 * relay can answer "what cites this". NIP-18 and NIP-22 both use `q` for it,
 * and it has to be a tag to be any of those things.
 *
 * Relay hints and the author come along where the identifier carries them —
 * that is the entire reason `nevent` and `naddr` exist rather than plain
 * `note`, and dropping them makes the citation harder to resolve than the
 * text it came from.
 */
export function extractQuotedEvents(
  content: string,
  decode: (value: string) => { type: string; data: unknown }
): QuotedEvent[] {
  const quotes = new Map<string, QuotedEvent>();

  for (const [, uri] of content.matchAll(NOSTR_EVENT_URI)) {
    try {
      const decoded = decode(uri);

      if (decoded.type === 'note') {
        const id = decoded.data as string;
        if (!quotes.has(id)) quotes.set(id, { value: id });
        continue;
      }

      if (decoded.type === 'nevent') {
        const data = decoded.data as {
          id: string;
          relays?: string[];
          author?: string;
        };

        quotes.set(data.id, {
          value: data.id,
          relay: data.relays?.[0],
          pubkey: data.author,
        });
        continue;
      }

      if (decoded.type === 'naddr') {
        const data = decoded.data as {
          kind: number;
          pubkey: string;
          identifier: string;
          relays?: string[];
        };

        const address = `${data.kind}:${data.pubkey}:${data.identifier}`;

        /**
         * No pubkey in the fourth position: NIP-22 asks for it only for a
         * regular event, and an address already names its author in full.
         */
        quotes.set(address, { value: address, relay: data.relays?.[0] });
      }
    } catch {
      // A malformed URI is just text; it should not block publishing
    }
  }

  return [...quotes.values()];
}
