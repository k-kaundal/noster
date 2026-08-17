import { describe, it, expect, beforeEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  RELAY_LIST_KIND,
  authorsIn,
  relayHintsFor,
  rememberRelayLists,
  resetOutboxTable,
  routableAuthors,
  withAuthorHints,
} from './outboxRouting';

function relayList(
  pubkey: string,
  relays: string[],
  createdAt = 1000
): NostrEvent {
  return {
    id: `${pubkey}-${createdAt}`,
    kind: RELAY_LIST_KIND,
    pubkey,
    created_at: createdAt,
    content: '',
    tags: relays.map((url) => ['r', url]),
    sig: '',
  };
}

beforeEach(resetOutboxTable);

describe('authorsIn', () => {
  it('collects the authors a request names', () => {
    expect(authorsIn([{ authors: ['alice', 'bob'] }])).toEqual(['alice', 'bob']);
  });

  it('merges authors across filters without repeating them', () => {
    const authors = authorsIn([{ authors: ['alice'] }, { authors: ['alice', 'bob'] }]);
    expect(authors).toEqual(['alice', 'bob']);
  });

  it('routes nothing when any filter is open', () => {
    /*
     * A request that is partly an author lookup and partly an open
     * subscription still needs the general relays. Narrowing it would drop
     * half of what it asked for.
     */
    expect(authorsIn([{ authors: ['alice'] }, {}])).toEqual([]);
  });

  it('routes nothing for an empty request', () => {
    expect(authorsIn([])).toEqual([]);
    expect(authorsIn([{ authors: [] }])).toEqual([]);
  });
});

describe('rememberRelayLists', () => {
  it('learns where an author publishes', () => {
    expect(rememberRelayLists([relayList('alice', ['wss://a.example'])])).toBe(true);
    expect(relayHintsFor(['alice'])).toEqual(['wss://a.example']);
  });

  it('ignores events that are not relay lists', () => {
    const note = { ...relayList('alice', ['wss://a.example']), kind: 1 };

    expect(rememberRelayLists([note])).toBe(false);
    expect(routableAuthors()).toBe(0);
  });

  it('takes the newer list', () => {
    rememberRelayLists([relayList('alice', ['wss://old.example'], 100)]);
    rememberRelayLists([relayList('alice', ['wss://new.example'], 200)]);

    expect(relayHintsFor(['alice'])).toEqual(['wss://new.example']);
  });

  it('ignores an older list arriving late', () => {
    // Relays answer at different speeds; the slow one is often the stale one
    rememberRelayLists([relayList('alice', ['wss://new.example'], 200)]);
    expect(rememberRelayLists([relayList('alice', ['wss://old.example'], 100)])).toBe(false);

    expect(relayHintsFor(['alice'])).toEqual(['wss://new.example']);
  });

  it('ignores a list with nothing usable in it', () => {
    const empty = { ...relayList('alice', []), tags: [['r', '']] };

    expect(rememberRelayLists([empty])).toBe(false);
    expect(routableAuthors()).toBe(0);
  });

  it('normalizes relay urls, so one relay is not two sockets', () => {
    rememberRelayLists([relayList('alice', ['wss://A.example/'])]);
    expect(relayHintsFor(['alice'])).toEqual(['wss://a.example']);
  });

  it('reads only the relays an author writes to', () => {
    // Reading someone means asking where they publish, not where they read
    const mixed: NostrEvent = {
      ...relayList('alice', []),
      tags: [
        ['r', 'wss://writes.example', 'write'],
        ['r', 'wss://reads.example', 'read'],
      ],
    };

    rememberRelayLists([mixed]);
    expect(relayHintsFor(['alice'])).toEqual(['wss://writes.example']);
  });
});

describe('relayHintsFor', () => {
  it('puts the relay shared by most of the authors first', () => {
    /*
     * A query goes to all the chosen relays at once, so one relay covering
     * three authors beats three relays covering one each — and the budget is
     * small enough that the difference decides who gets read at all.
     */
    rememberRelayLists([
      relayList('alice', ['wss://shared.example', 'wss://alice.example']),
      relayList('bob', ['wss://shared.example']),
      relayList('carol', ['wss://shared.example', 'wss://carol.example']),
    ]);

    expect(relayHintsFor(['alice', 'bob', 'carol'])[0]).toBe('wss://shared.example');
  });

  it('orders the same on every device holding the same table', () => {
    rememberRelayLists([relayList('alice', ['wss://b.example', 'wss://a.example'])]);

    expect(relayHintsFor(['alice'])).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('has nothing for an author it has never seen', () => {
    expect(relayHintsFor(['stranger'])).toEqual([]);
  });
});

describe('withAuthorHints', () => {
  const base = ['wss://1', 'wss://2', 'wss://3', 'wss://4', 'wss://5'];

  it('never asks more relays than the budget allows', () => {
    // The point is to ask better relays, not more of them
    const routed = withAuthorHints(base, ['wss://a', 'wss://b', 'wss://c'], 5);
    expect(routed).toHaveLength(5);
  });

  it('makes room for the authors by dropping the reader tail', () => {
    const routed = withAuthorHints(base, ['wss://a', 'wss://b', 'wss://c'], 5);

    expect(routed).toEqual(['wss://1', 'wss://2', 'wss://a', 'wss://b', 'wss://c']);
  });

  it('keeps the primary relay, which sits first', () => {
    const routed = withAuthorHints(base, ['wss://a', 'wss://b', 'wss://c'], 5);
    expect(routed[0]).toBe('wss://1');
  });

  it('never gives every slot away, however many hints there are', () => {
    const many = ['wss://a', 'wss://b', 'wss://c', 'wss://d', 'wss://e', 'wss://f'];
    const routed = withAuthorHints(base, many, 5);

    // A stale relay list must not be able to make somebody unreadable
    expect(routed.filter((relay) => base.includes(relay)).length).toBeGreaterThan(0);
  });

  it('changes nothing when the hints are already being asked', () => {
    expect(withAuthorHints(base, ['wss://2', 'wss://3'], 5)).toEqual(base);
  });

  it('changes nothing when there are no hints', () => {
    expect(withAuthorHints(base, [], 5)).toEqual(base);
  });

  it('still truncates to the budget with no hints', () => {
    expect(withAuthorHints(base, [], 3)).toEqual(['wss://1', 'wss://2', 'wss://3']);
  });

  it('copes with a budget of one', () => {
    expect(withAuthorHints(base, ['wss://a'], 1)).toEqual(['wss://1']);
  });
});
