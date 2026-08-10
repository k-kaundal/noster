import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  DRAFT_WRAP_KIND,
  buildDraftWrapTags,
  draftIdentifierOf,
  draftKindOf,
  isDeletedDraft,
  parseDraft,
  serializeDraft,
} from './nip37';

function wrap(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'w'.repeat(64),
    pubkey: 'a'.repeat(64),
    kind: DRAFT_WRAP_KIND,
    content: 'encrypted-blob',
    tags: [['d', 'my-post'], ['k', '30023']],
    created_at: 0,
    sig: '',
    ...overrides,
  };
}

describe('buildDraftWrapTags', () => {
  const tags = buildDraftWrapTags({
    identifier: 'my-post',
    kind: 30023,
    now: 1_700_000_000,
  });

  it('addresses the draft and names the kind it holds', () => {
    // Without `k`, finding your article drafts means decrypting every draft
    // you have ever saved of any kind to see what it was
    expect(tags).toContainEqual(['d', 'my-post']);
    expect(tags).toContainEqual(['k', '30023']);
  });

  it('asks relays to drop it after ninety days', () => {
    expect(tags).toContainEqual(['expiration', String(1_700_000_000 + 90 * 86400)]);
  });

  it('takes a shorter retention when asked', () => {
    const short = buildDraftWrapTags({
      identifier: 'x',
      kind: 30023,
      now: 0,
      ttlDays: 1,
    });

    expect(short).toContainEqual(['expiration', String(86400)]);
  });
});

describe('serializeDraft and parseDraft', () => {
  const draft = {
    kind: 30023,
    content: '# Half a thought',
    tags: [['d', 'my-post'], ['title', 'Untitled']],
    created_at: 1_700_000_000,
  };

  it('round-trips a draft', () => {
    expect(parseDraft(serializeDraft(draft))).toEqual(draft);
  });

  it('keeps the author when one was recorded', () => {
    const withAuthor = { ...draft, pubkey: 'a'.repeat(64) };
    expect(parseDraft(serializeDraft(withAuthor))).toEqual(withAuthor);
  });

  it('refuses plaintext that is not JSON', () => {
    // A wrap whose contents do not parse is a bug or a truncated payload, not
    // a draft, and rendering it would produce an article with no kind
    expect(parseDraft('not json')).toBeNull();
    expect(parseDraft('')).toBeNull();
  });

  it('refuses JSON that is not an event', () => {
    expect(parseDraft('"a string"')).toBeNull();
    expect(parseDraft('null')).toBeNull();
    expect(parseDraft(JSON.stringify({ content: 'x', tags: [] }))).toBeNull();
    expect(parseDraft(JSON.stringify({ kind: 30023, tags: [] }))).toBeNull();
    expect(parseDraft(JSON.stringify({ kind: 30023, content: 'x' }))).toBeNull();
  });

  it('drops tags that are not arrays of strings', () => {
    // Every consumer destructures them, so one malformed entry would throw
    // somewhere far from here
    const parsed = parseDraft(
      JSON.stringify({
        kind: 30023,
        content: 'x',
        tags: [['d', 'ok'], 'nope', [1, 2], ['title', 'also ok']],
        created_at: 1,
      })
    );

    expect(parsed?.tags).toEqual([['d', 'ok'], ['title', 'also ok']]);
  });

  it('supplies a timestamp when the draft carries none', () => {
    const parsed = parseDraft(
      JSON.stringify({ kind: 30023, content: 'x', tags: [] })
    );

    expect(parsed?.created_at).toBeGreaterThan(0);
  });
});

describe('isDeletedDraft', () => {
  it('reads a blanked content as deletion', () => {
    // Addressable, so an empty one replaces the draft in place rather than
    // depending on a relay honouring a deletion request
    expect(isDeletedDraft(wrap({ content: '' }))).toBe(true);
    expect(isDeletedDraft(wrap({ content: '   ' }))).toBe(true);
  });

  it('leaves a live draft alone', () => {
    expect(isDeletedDraft(wrap())).toBe(false);
  });
});

describe('draftKindOf', () => {
  it('reads the wrapped kind', () => {
    expect(draftKindOf(wrap())).toBe(30023);
  });

  it('says nothing when the tag is missing or not a kind', () => {
    expect(draftKindOf(wrap({ tags: [['d', 'x']] }))).toBeUndefined();
    expect(draftKindOf(wrap({ tags: [['k', 'article']] }))).toBeUndefined();
    expect(draftKindOf(wrap({ tags: [['k', '']] }))).toBeUndefined();
  });
});

describe('draftIdentifierOf', () => {
  it('reads the address identifier', () => {
    expect(draftIdentifierOf(wrap())).toBe('my-post');
  });

  it('treats an empty identifier as absent', () => {
    expect(draftIdentifierOf(wrap({ tags: [['d', '']] }))).toBeUndefined();
  });
});
