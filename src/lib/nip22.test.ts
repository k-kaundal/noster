import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  acceptsComments,
  addressOf,
  buildCommentTags,
  isTopLevel,
  isValidComment,
  parentOf,
  targetFromEvent,
  targetFromUrl,
} from './nip22';

const AUTHOR = 'a'.repeat(64);
const COMMENTER = 'b'.repeat(64);

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey: AUTHOR,
    kind: 1,
    content: '',
    tags: [],
    created_at: 0,
    sig: '',
    ...overrides,
  };
}

/** Every tag with this name, minus the name itself. */
function values(tags: string[][], name: string): string[][] {
  return tags
    .filter(([tagName]) => tagName === name)
    .map(([, ...rest]) => rest);
}

describe('addressOf', () => {
  it('builds an addressable event address from its d tag', () => {
    const article = event({ kind: 30023, tags: [['d', 'my-post']] });
    expect(addressOf(article)).toBe(`30023:${AUTHOR}:my-post`);
  });

  it('ends a replaceable address with an empty identifier', () => {
    expect(addressOf(event({ kind: 10002 }))).toBe(`10002:${AUTHOR}:`);
  });

  it('gives a regular event no address, because it has none', () => {
    expect(addressOf(event({ kind: 1063 }))).toBeUndefined();
  });

  it('treats a missing d tag as the empty identifier', () => {
    expect(addressOf(event({ kind: 30023 }))).toBe(`30023:${AUTHOR}:`);
  });
});

describe('buildCommentTags', () => {
  const article = event({ kind: 30023, tags: [['d', 'my-post']] });
  const file = event({ kind: 1063 });

  describe('a top-level comment on an article', () => {
    const tags = buildCommentTags({
      root: targetFromEvent(article, 'wss://relay.example'),
    });

    it('scopes to the address, not to one revision of it', () => {
      // Pinning the scope to an event id would orphan every comment the next
      // time the author fixed a typo
      expect(values(tags, 'A')).toEqual([
        [`30023:${AUTHOR}:my-post`, 'wss://relay.example'],
      ]);
      expect(values(tags, 'E')).toEqual([]);
    });

    it('names the root kind and author in uppercase', () => {
      expect(values(tags, 'K')).toEqual([['30023']]);
      expect(values(tags, 'P')).toEqual([[AUTHOR, 'wss://relay.example']]);
    });

    it('repeats the root as the parent, which is what top-level means', () => {
      expect(values(tags, 'a')).toEqual([
        [`30023:${AUTHOR}:my-post`, 'wss://relay.example'],
      ]);
      expect(values(tags, 'k')).toEqual([['30023']]);
      expect(values(tags, 'p')).toEqual([[AUTHOR, 'wss://relay.example']]);
    });

    it('also gives the addressable parent an e tag, as the spec asks', () => {
      expect(values(tags, 'e')).toEqual([
        ['e'.repeat(64), 'wss://relay.example', AUTHOR],
      ]);
    });
  });

  describe('a top-level comment on a regular event', () => {
    const tags = buildCommentTags({ root: targetFromEvent(file) });

    it('scopes by id, and carries the author in the fourth position', () => {
      // The pubkey hint is what lets a client resolve the root without
      // already knowing who wrote it
      expect(values(tags, 'E')).toEqual([['e'.repeat(64), '', AUTHOR]]);
      expect(values(tags, 'A')).toEqual([]);
    });

    it('states both kinds, which are required and usually forgotten', () => {
      expect(values(tags, 'K')).toEqual([['1063']]);
      expect(values(tags, 'k')).toEqual([['1063']]);
    });
  });

  describe('a reply to a comment', () => {
    const comment = event({ id: 'c'.repeat(64), pubkey: COMMENTER, kind: 1111 });

    const tags = buildCommentTags({
      root: targetFromEvent(file),
      parent: targetFromEvent(comment),
    });

    it('keeps the root scope pointing at the root, not the comment', () => {
      expect(values(tags, 'E')).toEqual([['e'.repeat(64), '', AUTHOR]]);
      expect(values(tags, 'K')).toEqual([['1063']]);
      expect(values(tags, 'P')).toEqual([[AUTHOR]]);
    });

    it('points the lowercase tags at the comment being answered', () => {
      expect(values(tags, 'e')).toEqual([['c'.repeat(64), '', COMMENTER]]);
      expect(values(tags, 'k')).toEqual([['1111']]);
      expect(values(tags, 'p')).toEqual([[COMMENTER]]);
    });
  });

  describe('a comment on a web page', () => {
    const tags = buildCommentTags({
      root: targetFromUrl('https://abc.com/articles/1'),
    });

    it('uses the NIP-73 kind `web`, not the hostname', () => {
      // The hostname is a value, not a type, and every other client filters
      // on #K: ["web"]
      expect(values(tags, 'K')).toEqual([['web']]);
      expect(values(tags, 'k')).toEqual([['web']]);
    });

    it('scopes with I and i', () => {
      expect(values(tags, 'I')).toEqual([['https://abc.com/articles/1']]);
      expect(values(tags, 'i')).toEqual([['https://abc.com/articles/1']]);
    });

    it('claims no author, because a web page has no pubkey', () => {
      expect(values(tags, 'P')).toEqual([]);
      expect(values(tags, 'p')).toEqual([]);
    });
  });

  describe('a comment on a podcast episode', () => {
    const tags = buildCommentTags({
      root: {
        type: 'external',
        value: 'podcast:item:guid:d98d189b',
        kind: 'podcast:item:guid',
        hint: 'https://fountain.fm/episode/z1y9',
      },
    });

    it('keeps the external kind verbatim', () => {
      expect(values(tags, 'K')).toEqual([['podcast:item:guid']]);
      expect(values(tags, 'I')).toEqual([
        ['podcast:item:guid:d98d189b', 'https://fountain.fm/episode/z1y9'],
      ]);
    });
  });

  describe('citations and mentions', () => {
    it('adds q tags for events cited in the content', () => {
      const tags = buildCommentTags({
        root: targetFromEvent(file),
        quotes: [{ value: 'q'.repeat(64), relay: 'wss://r', pubkey: COMMENTER }],
      });

      expect(values(tags, 'q')).toEqual([
        ['q'.repeat(64), 'wss://r', COMMENTER],
      ]);
    });

    it('adds p tags for pubkeys named in the content', () => {
      const tags = buildCommentTags({
        root: targetFromEvent(file),
        mentions: [COMMENTER],
      });

      expect(values(tags, 'p')).toEqual([[AUTHOR], [COMMENTER]]);
    });

    it('does not tag the same person twice', () => {
      // Two p tags for one person is how a single reply arrives as two
      // notifications
      const tags = buildCommentTags({
        root: targetFromEvent(file),
        mentions: [AUTHOR, AUTHOR],
      });

      expect(values(tags, 'p')).toEqual([[AUTHOR]]);
    });
  });

  it('does not pad tags with empty strings it does not need', () => {
    const tags = buildCommentTags({ root: targetFromUrl('https://abc.com') });
    expect(tags.every((entry) => entry[entry.length - 1] !== '')).toBe(true);
  });
});

describe('isValidComment', () => {
  const good = event({
    kind: 1111,
    tags: [
      ['E', 'e'.repeat(64)],
      ['K', '1063'],
      ['e', 'e'.repeat(64)],
      ['k', '1063'],
    ],
  });

  it('accepts a well-formed comment', () => {
    expect(isValidComment(good)).toBe(true);
  });

  it('rejects one with no root scope', () => {
    expect(
      isValidComment(event({ kind: 1111, tags: [['e', 'x'], ['k', '1'], ['K', '1']] }))
    ).toBe(false);
  });

  it('rejects one missing the required kind tags', () => {
    // Without them a reader has to fetch the root event before it can decide
    // how to render anything
    expect(
      isValidComment(event({ kind: 1111, tags: [['E', 'x'], ['e', 'x'], ['k', '1']] }))
    ).toBe(false);
    expect(
      isValidComment(event({ kind: 1111, tags: [['E', 'x'], ['e', 'x'], ['K', '1']] }))
    ).toBe(false);
  });

  it('rejects empty tag values, which are as good as absent', () => {
    expect(
      isValidComment(
        event({ kind: 1111, tags: [['E', ''], ['K', '1'], ['e', 'x'], ['k', '1']] })
      )
    ).toBe(false);
  });

  it('rejects events that are not comments at all', () => {
    expect(isValidComment(event({ kind: 1 }))).toBe(false);
  });
});

describe('parentOf', () => {
  it('reads the comment being answered', () => {
    const reply = event({
      kind: 1111,
      tags: [['E', 'root'], ['e', 'parent'], ['K', '1'], ['k', '1111']],
    });

    expect(parentOf(reply)).toBe('parent');
  });

  it('ignores the uppercase root scope', () => {
    // Reading `E` as the parent would flatten every thread into one level
    const reply = event({ kind: 1111, tags: [['E', 'root'], ['e', 'parent']] });
    expect(parentOf(reply)).toBe('parent');
  });

  it('falls back to an address or an external id', () => {
    expect(parentOf(event({ tags: [['a', '30023:x:y']] }))).toBe('30023:x:y');
    expect(parentOf(event({ tags: [['i', 'https://x']] }))).toBe('https://x');
  });
});

describe('isTopLevel', () => {
  const article = event({ kind: 30023, tags: [['d', 'my-post']] });
  const root = targetFromEvent(article);

  it('recognises a comment whose parent is the root itself', () => {
    const comment = event({
      kind: 1111,
      tags: buildCommentTags({ root }),
    });

    expect(isTopLevel(comment, root)).toBe(true);
  });

  it('rejects a reply to another comment', () => {
    const comment = event({ id: 'c'.repeat(64), kind: 1111, pubkey: COMMENTER });

    const reply = event({
      kind: 1111,
      tags: buildCommentTags({ root, parent: targetFromEvent(comment) }),
    });

    expect(isTopLevel(reply, root)).toBe(false);
  });

  it('works for URLs', () => {
    const url = targetFromUrl('https://abc.com/1');
    const comment = event({ kind: 1111, tags: buildCommentTags({ root: url }) });

    expect(isTopLevel(comment, url)).toBe(true);
  });
});

describe('the kind 1 prohibition', () => {
  const note: NostrEvent = {
    id: 'n'.repeat(64),
    pubkey: 'a'.repeat(64),
    kind: 1,
    created_at: 0,
    content: 'hi',
    tags: [],
    sig: '',
  };

  it('refuses to scope a comment to a note', () => {
    expect(acceptsComments(note)).toBe(false);

    // Silent when it goes wrong: the event publishes, and no client shows it
    expect(() => buildCommentTags({ root: targetFromEvent(note) })).toThrow(
      /NIP-10/
    );
  });

  it('allows every other kind', () => {
    for (const kind of [1063, 30023, 30402, 31923, 1111]) {
      expect(acceptsComments({ ...note, kind })).toBe(true);
    }
  });

  it('rejects a kind-1-scoped comment written by another client', () => {
    expect(
      isValidComment({
        ...note,
        kind: 1111,
        tags: [
          ['E', 'n'.repeat(64)],
          ['K', '1'],
          ['e', 'n'.repeat(64)],
          ['k', '1'],
        ],
      })
    ).toBe(false);
  });

  it('still accepts a comment whose parent is a comment on a note-free root', () => {
    expect(
      isValidComment({
        ...note,
        kind: 1111,
        tags: [
          ['A', '30023:x:y'],
          ['K', '30023'],
          ['e', 'c'.repeat(64)],
          ['k', '1111'],
        ],
      })
    ).toBe(true);
  });
});
