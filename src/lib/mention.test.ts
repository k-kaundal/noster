import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  applyMention,
  extractMentionPubkeys,
  extractQuotedEvents,
  findMentionQuery,
  rankMentions,
} from './mention';

const PUBKEY = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const NPUB = nip19.npubEncode(PUBKEY);

describe('findMentionQuery', () => {
  it('finds a mention being typed at the caret', () => {
    const text = 'hey @ali';
    expect(findMentionQuery(text, text.length)).toEqual({
      term: 'ali',
      start: 4,
      end: 8,
    });
  });

  it('opens on a bare "@" so the full list shows', () => {
    expect(findMentionQuery('hey @', 5)?.term).toBe('');
  });

  it('opens at the very start of the text', () => {
    expect(findMentionQuery('@bob', 4)?.start).toBe(0);
  });

  it('ignores an email address', () => {
    const text = 'write to me@example.com';
    expect(findMentionQuery(text, text.length)).toBeNull();
  });

  it('ignores text with no "@" before the caret', () => {
    expect(findMentionQuery('just a note', 11)).toBeNull();
  });

  it('stops at whitespace rather than scanning the whole note', () => {
    const text = '@bob said hello';
    // The caret sits after "hello", which is not part of the mention
    expect(findMentionQuery(text, text.length)).toBeNull();
  });

  it('opens after an opening parenthesis', () => {
    expect(findMentionQuery('(@bob', 5)?.term).toBe('bob');
  });

  it('gives up on a pasted npub rather than searching for it', () => {
    const text = `@${'x'.repeat(50)}`;
    expect(findMentionQuery(text, text.length)).toBeNull();
  });

  it('lowercases the term so matching is case-insensitive', () => {
    expect(findMentionQuery('@ALICE', 6)?.term).toBe('alice');
  });
});

describe('applyMention', () => {
  it('replaces the typed name with a nostr URI', () => {
    const text = 'hey @ali';
    const query = findMentionQuery(text, text.length)!;
    const result = applyMention(text, query, NPUB);

    expect(result.text).toBe(`hey nostr:${NPUB} `);
    // The caret lands after the trailing space, ready to keep typing
    expect(result.caret).toBe(result.text.length);
  });

  it('keeps the text that follows the mention intact', () => {
    const text = 'hey @ali how are you';
    const query = findMentionQuery(text, 8)!;

    expect(applyMention(text, query, NPUB).text).toBe(
      `hey nostr:${NPUB}  how are you`
    );
  });
});

describe('extractMentionPubkeys', () => {
  it('pulls pubkeys out of npub URIs', () => {
    const content = `hello nostr:${NPUB}, good to see you`;
    expect(extractMentionPubkeys(content, nip19.decode)).toEqual([PUBKEY]);
  });

  it('handles nprofile URIs too', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: OTHER, relays: [] });
    expect(
      extractMentionPubkeys(`hi nostr:${nprofile}`, nip19.decode)
    ).toEqual([OTHER]);
  });

  it('mentions someone once however many times they appear', () => {
    const content = `nostr:${NPUB} and again nostr:${NPUB}`;
    expect(extractMentionPubkeys(content, nip19.decode)).toEqual([PUBKEY]);
  });

  it('ignores note and event references, which are not people', () => {
    const note = nip19.noteEncode('c'.repeat(64));
    expect(extractMentionPubkeys(`see nostr:${note}`, nip19.decode)).toEqual([]);
  });

  it('survives a malformed URI rather than refusing to publish', () => {
    expect(
      extractMentionPubkeys('nostr:npub1notvalid', nip19.decode)
    ).toEqual([]);
  });
});

describe('rankMentions', () => {
  const people = [
    { displayName: 'Alice', name: 'alice', nip05: 'alice@example.com' },
    { displayName: 'Bob', name: 'bob' },
    { displayName: 'Malice', name: 'malice' },
  ];

  it('puts prefix matches ahead of substring matches', () => {
    const ranked = rankMentions(people, 'alice');
    expect(ranked[0].displayName).toBe('Alice');
    expect(ranked).toHaveLength(2);
  });

  it('matches on the nip05 address', () => {
    expect(rankMentions(people, 'example')[0].displayName).toBe('Alice');
  });

  it('returns the head of the list for an empty term', () => {
    expect(rankMentions(people, '', 2)).toHaveLength(2);
  });

  it('returns nothing when nobody matches', () => {
    expect(rankMentions(people, 'zzz')).toEqual([]);
  });
});

describe('extractQuotedEvents', () => {
  const ID = 'c'.repeat(64);

  it('lifts a plain note reference out of the text', () => {
    const content = `look at nostr:${nip19.noteEncode(ID)} for context`;

    expect(extractQuotedEvents(content, nip19.decode)).toEqual([{ value: ID }]);
  });

  it('keeps the relay hint and author an nevent carries', () => {
    // Dropping them makes the citation harder to resolve than the text it
    // came from, which is the whole reason nevent exists
    const nevent = nip19.neventEncode({
      id: ID,
      relays: ['wss://relay.example'],
      author: PUBKEY,
    });

    expect(extractQuotedEvents(`see nostr:${nevent}`, nip19.decode)).toEqual([
      { value: ID, relay: 'wss://relay.example', pubkey: PUBKEY },
    ]);
  });

  it('turns an naddr into an address, with no separate author', () => {
    // An address already names its author, and NIP-22 asks for the fourth
    // position only for regular events
    const naddr = nip19.naddrEncode({
      kind: 30023,
      pubkey: PUBKEY,
      identifier: 'my-post',
    });

    expect(extractQuotedEvents(`nostr:${naddr}`, nip19.decode)).toEqual([
      { value: `30023:${PUBKEY}:my-post` },
    ]);
  });

  it('ignores mentions of people, which are p tags not q tags', () => {
    expect(extractQuotedEvents(`hi nostr:${NPUB}`, nip19.decode)).toEqual([]);
  });

  it('cites each event once however often it is written', () => {
    const note = `nostr:${nip19.noteEncode(ID)}`;

    expect(extractQuotedEvents(`${note} and again ${note}`, nip19.decode)).toEqual([
      { value: ID },
    ]);
  });

  it('does not let a malformed URI stop the rest', () => {
    const content = `nostr:note1broken and nostr:${nip19.noteEncode(ID)}`;

    expect(extractQuotedEvents(content, nip19.decode)).toEqual([{ value: ID }]);
  });

  it('finds nothing in text with no citations', () => {
    expect(extractQuotedEvents('just words', nip19.decode)).toEqual([]);
  });
});
