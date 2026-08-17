import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  isAddressable,
  isEphemeral,
  isReplaceable,
  mergeEvents,
  recordKey,
  supersedes,
  uniqueAuthors,
} from './eventMerge';

function event(over: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    kind: 1,
    pubkey: 'b'.repeat(64),
    created_at: 1000,
    content: '',
    tags: [],
    sig: '',
    ...over,
  };
}

describe('storage classes', () => {
  it('knows the replaceable kinds', () => {
    expect(isReplaceable(0)).toBe(true);
    expect(isReplaceable(3)).toBe(true);
    expect(isReplaceable(10002)).toBe(true);
    expect(isReplaceable(19999)).toBe(true);
    expect(isReplaceable(1)).toBe(false);
    expect(isReplaceable(30023)).toBe(false);
  });

  it('knows the addressable kinds', () => {
    expect(isAddressable(30000)).toBe(true);
    expect(isAddressable(39999)).toBe(true);
    expect(isAddressable(40000)).toBe(false);
    expect(isAddressable(10002)).toBe(false);
  });

  it('knows the ephemeral kinds', () => {
    expect(isEphemeral(20000)).toBe(true);
    expect(isEphemeral(29999)).toBe(true);
    expect(isEphemeral(30000)).toBe(false);
  });
});

describe('recordKey', () => {
  it('gives a regular event its own identity', () => {
    expect(recordKey(event({ id: 'x', kind: 1 }))).toBe('x');
  });

  it('gives two revisions of a contact list one identity', () => {
    // The follower-count bug in one assertion: these are the same person
    const first = event({ id: 'x', kind: 3, pubkey: 'alice' });
    const second = event({ id: 'y', kind: 3, pubkey: 'alice', created_at: 2000 });

    expect(recordKey(first)).toBe(recordKey(second));
  });

  it('separates addressable events by their d tag', () => {
    const one = event({ kind: 30023, pubkey: 'alice', tags: [['d', 'post-1']] });
    const two = event({ kind: 30023, pubkey: 'alice', tags: [['d', 'post-2']] });

    expect(recordKey(one)).not.toBe(recordKey(two));
  });

  it('treats a missing d tag as the empty one, per NIP-01', () => {
    const bare = event({ kind: 30023, pubkey: 'alice' });
    const empty = event({ kind: 30023, pubkey: 'alice', tags: [['d', '']] });

    expect(recordKey(bare)).toBe(recordKey(empty));
  });
});

describe('supersedes', () => {
  it('prefers the newer revision', () => {
    const old = event({ id: 'a', created_at: 1000 });
    const fresh = event({ id: 'z', created_at: 2000 });

    expect(supersedes(fresh, old)).toBe(true);
    expect(supersedes(old, fresh)).toBe(false);
  });

  it('breaks a tie on the lowest id, so every device agrees', () => {
    const lower = event({ id: 'aaa', created_at: 1000 });
    const higher = event({ id: 'zzz', created_at: 1000 });

    expect(supersedes(lower, higher)).toBe(true);
    expect(supersedes(higher, lower)).toBe(false);
  });
});

describe('mergeEvents', () => {
  it('keeps what both sides know', () => {
    const merged = mergeEvents(
      [event({ id: 'a' })],
      [event({ id: 'b', created_at: 900 })]
    );

    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('never loses an event the new response happened to omit', () => {
    // The whole point: a relay answering with less must not shrink the answer
    const held = [event({ id: 'a' }), event({ id: 'b', created_at: 900 })];

    expect(mergeEvents(held, []).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('counts one person once however many revisions arrive', () => {
    const revisions = [
      event({ id: 'r1', kind: 3, pubkey: 'alice', created_at: 100 }),
      event({ id: 'r2', kind: 3, pubkey: 'alice', created_at: 200 }),
      event({ id: 'r3', kind: 3, pubkey: 'alice', created_at: 300 }),
    ];

    const merged = mergeEvents([], revisions);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('r3');
  });

  it('replaces a held revision with a newer one', () => {
    const merged = mergeEvents(
      [event({ id: 'old', kind: 3, pubkey: 'alice', created_at: 100 })],
      [event({ id: 'new', kind: 3, pubkey: 'alice', created_at: 200 })]
    );

    expect(merged.map((e) => e.id)).toEqual(['new']);
  });

  it('keeps the held revision when the arriving one is older', () => {
    const merged = mergeEvents(
      [event({ id: 'new', kind: 3, pubkey: 'alice', created_at: 200 })],
      [event({ id: 'old', kind: 3, pubkey: 'alice', created_at: 100 })]
    );

    expect(merged.map((e) => e.id)).toEqual(['new']);
  });

  it('throws away ephemeral events', () => {
    expect(mergeEvents([], [event({ kind: 22242 })])).toEqual([]);
  });

  it('sorts newest first', () => {
    const merged = mergeEvents([], [
      event({ id: 'a', created_at: 100 }),
      event({ id: 'b', created_at: 300 }),
      event({ id: 'c', created_at: 200 }),
    ]);

    expect(merged.map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('orders identically whatever order the relays answered in', () => {
    // Two devices holding the same events must render the same list
    const events = [
      event({ id: 'c', created_at: 100 }),
      event({ id: 'a', created_at: 100 }),
      event({ id: 'b', created_at: 100 }),
    ];

    const forwards = mergeEvents([], events).map((e) => e.id);
    const backwards = mergeEvents([], [...events].reverse()).map((e) => e.id);

    expect(forwards).toEqual(backwards);
  });

  it('caps by dropping the oldest, not whatever arrived last', () => {
    const merged = mergeEvents(
      [event({ id: 'old', created_at: 100 })],
      [event({ id: 'new', created_at: 900 })],
      1
    );

    expect(merged.map((e) => e.id)).toEqual(['new']);
  });

  it('treats a cap of zero as no cap', () => {
    const merged = mergeEvents([], [event({ id: 'a' }), event({ id: 'b', created_at: 2 })], 0);
    expect(merged).toHaveLength(2);
  });
});

describe('uniqueAuthors', () => {
  it('counts people rather than events', () => {
    const events = [
      event({ id: '1', pubkey: 'alice' }),
      event({ id: '2', pubkey: 'alice' }),
      event({ id: '3', pubkey: 'bob' }),
    ];

    expect(uniqueAuthors(events)).toEqual(['alice', 'bob']);
  });

  it('has nobody in an empty set', () => {
    expect(uniqueAuthors([])).toEqual([]);
  });
});
