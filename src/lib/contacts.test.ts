import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { contactTags, latestContactList, reviseContacts } from './contacts';

function list(createdAt: number, people: string[]): NostrEvent {
  return {
    id: `id-${createdAt}`,
    pubkey: 'author',
    created_at: createdAt,
    kind: 3,
    tags: people.map((pubkey) => ['p', pubkey]),
    content: '',
    sig: '',
  } as NostrEvent;
}

describe('latestContactList', () => {
  it('picks the newest revision, not the first one returned', () => {
    // The whole point: relays answer in no particular order, and the stale
    // one arriving first is what deletes follows when it gets written back
    const stale = list(100, ['a', 'b']);
    const current = list(200, ['a', 'b', 'c', 'd']);

    expect(latestContactList([stale, current])).toBe(current);
    expect(latestContactList([current, stale])).toBe(current);
  });

  it('ignores gaps, so a failed read cannot win', () => {
    const current = list(200, ['a']);
    expect(latestContactList([undefined, current, undefined])).toBe(current);
  });

  it('has no answer when nothing was readable', () => {
    expect(latestContactList([])).toBeUndefined();
    expect(latestContactList([undefined])).toBeUndefined();
  });
});

describe('contactTags', () => {
  it('takes only p tags that name someone', () => {
    const event = {
      ...list(1, []),
      tags: [
        ['p', 'a'],
        ['p', ''],
        ['e', 'not-a-person'],
        ['p', 'b', 'wss://relay.example', 'bob'],
      ],
    } as NostrEvent;

    expect(contactTags(event)).toEqual([
      ['p', 'a'],
      ['p', 'b', 'wss://relay.example', 'bob'],
    ]);
  });

  it('reads an absent list as empty rather than throwing', () => {
    expect(contactTags(undefined)).toEqual([]);
  });
});

describe('reviseContacts', () => {
  it('appends without disturbing what is already there', () => {
    const existing = [['p', 'a'], ['p', 'b']];

    expect(reviseContacts(existing, { add: ['c'] })).toEqual([
      ['p', 'a'],
      ['p', 'b'],
      ['p', 'c'],
    ]);
  });

  it('keeps relay hints and petnames on entries it carries through', () => {
    // Rebuilding these as ['p', pubkey] silently discards someone's petnames
    const existing = [['p', 'a', 'wss://relay.example', 'alice']];

    expect(reviseContacts(existing, { add: ['b'] })[0]).toEqual([
      'p',
      'a',
      'wss://relay.example',
      'alice',
    ]);
  });

  it('does not add someone who is already followed', () => {
    const existing = [['p', 'a']];
    expect(reviseContacts(existing, { add: ['a'] })).toEqual([['p', 'a']]);
  });

  it('collapses repeats within one call', () => {
    expect(reviseContacts([], { add: ['a', 'a', 'b'] })).toEqual([
      ['p', 'a'],
      ['p', 'b'],
    ]);
  });

  it('removes only the named entry', () => {
    const existing = [['p', 'a'], ['p', 'b'], ['p', 'c']];

    expect(reviseContacts(existing, { remove: ['b'] })).toEqual([
      ['p', 'a'],
      ['p', 'c'],
    ]);
  });

  it('adds a batch in one revision', () => {
    // What "follow everyone in this list" produces: one event, not twenty
    const existing = [['p', 'a']];
    const revised = reviseContacts(existing, { add: ['b', 'c', 'd'] });

    expect(revised).toHaveLength(4);
    expect(revised.map((tag) => tag[1])).toEqual(['a', 'b', 'c', 'd']);
  });
});
