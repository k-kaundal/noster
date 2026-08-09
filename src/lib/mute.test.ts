import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  EMPTY_MUTE_LIST,
  buildMuteListTags,
  containsWord,
  filterMuted,
  getMuteReason,
  parseMuteList,
  type MuteList,
} from './mute';

function note(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...overrides,
  };
}

function list(overrides: Partial<MuteList> = {}): MuteList {
  return { ...EMPTY_MUTE_LIST, ...overrides };
}

describe('containsWord', () => {
  it('matches a whole word regardless of case', () => {
    expect(containsWord('I love Art today', 'art')).toBe(true);
    expect(containsWord('i love art today', 'ART')).toBe(true);
  });

  it('does not match inside longer words', () => {
    // The whole point of word boundaries: muting "art" must not hide these
    for (const text of ['start the day', 'a party tonight', 'so smart']) {
      expect(containsWord(text, 'art'), text).toBe(false);
    }
  });

  it('treats punctuation as a boundary', () => {
    expect(containsWord('(art), finally!', 'art')).toBe(true);
    expect(containsWord('art.', 'art')).toBe(true);
  });

  it('applies boundaries to non-English scripts', () => {
    expect(containsWord('это искусство здесь', 'искусство')).toBe(true);
    expect(containsWord('искусствоведение', 'искусство')).toBe(false);
  });

  it('matches multi-word phrases', () => {
    expect(containsWord('the price of bitcoin etf today', 'bitcoin etf')).toBe(
      true
    );
    expect(containsWord('bitcoin, then etf', 'bitcoin etf')).toBe(false);
  });

  it('treats regex metacharacters literally', () => {
    expect(containsWord('the c++ language', 'c++')).toBe(true);
    expect(containsWord('the cxx language', 'c++')).toBe(false);
  });

  it('ignores blank words rather than muting everything', () => {
    expect(containsWord('anything at all', '   ')).toBe(false);
  });
});

describe('parseMuteList', () => {
  it('returns an empty list when nothing is published', () => {
    expect(parseMuteList(undefined)).toEqual(EMPTY_MUTE_LIST);
  });

  it('reads each tag type and normalises case', () => {
    const parsed = parseMuteList(
      note({
        kind: 10000,
        tags: [
          ['p', 'd'.repeat(64)],
          ['t', '#Bitcoin'],
          ['word', 'SPOILERS'],
          ['e', 'f'.repeat(64)],
        ],
      })
    );

    expect(parsed).toEqual({
      pubkeys: ['d'.repeat(64)],
      hashtags: ['bitcoin'],
      words: ['spoilers'],
      threads: ['f'.repeat(64)],
    });
  });

  it('round-trips through buildMuteListTags', () => {
    const original = list({
      pubkeys: ['d'.repeat(64)],
      hashtags: ['bitcoin'],
      words: ['spoilers'],
      threads: ['f'.repeat(64)],
    });

    expect(
      parseMuteList(note({ kind: 10000, tags: buildMuteListTags(original) }))
    ).toEqual(original);
  });
});

describe('getMuteReason', () => {
  it('reports the author when their pubkey is muted', () => {
    expect(
      getMuteReason(note(), list({ pubkeys: ['b'.repeat(64)] }))
    ).toMatchObject({ reason: 'author' });
  });

  it('reports an indexed hashtag', () => {
    expect(
      getMuteReason(
        note({ tags: [['t', 'Bitcoin']] }),
        list({ hashtags: ['bitcoin'] })
      )
    ).toMatchObject({ reason: 'hashtag' });
  });

  it('reports a hashtag written inline but never tagged', () => {
    expect(
      getMuteReason(
        note({ content: 'thoughts on #bitcoin?' }),
        list({ hashtags: ['bitcoin'] })
      )
    ).toMatchObject({ reason: 'hashtag' });
  });

  it('reports a muted word in the content', () => {
    expect(
      getMuteReason(
        note({ content: 'huge spoilers ahead' }),
        list({ words: ['spoilers'] })
      )
    ).toMatchObject({ reason: 'word' });
  });

  it('reports a reply into a muted thread', () => {
    expect(
      getMuteReason(
        note({ tags: [['e', 'f'.repeat(64)]] }),
        list({ threads: ['f'.repeat(64)] })
      )
    ).toMatchObject({ reason: 'thread' });
  });

  it('returns null for an event nothing matches', () => {
    expect(
      getMuteReason(
        note({ content: 'a start to the party' }),
        list({ words: ['art'], hashtags: ['music'], pubkeys: ['d'.repeat(64)] })
      ).reason
    ).toBeNull();
  });
});

describe('filterMuted', () => {
  it('returns the same array when the list is empty', () => {
    const events = [note()];
    expect(filterMuted(events, EMPTY_MUTE_LIST)).toBe(events);
  });

  it('drops only the muted events', () => {
    const kept = note({ id: '1'.repeat(64), content: 'hello' });
    const dropped = note({ id: '2'.repeat(64), content: 'spoilers within' });

    expect(filterMuted([kept, dropped], list({ words: ['spoilers'] }))).toEqual([
      kept,
    ]);
  });
});
