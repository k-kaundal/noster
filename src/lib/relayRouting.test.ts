import { describe, it, expect } from 'vitest';
import {
  RECEIPT_RELAYS,
  canonicalTargets,
  isIdentityRequest,
  isZapReceiptRequest,
  withPrimaryFirst,
} from './relayRouting';

const HOUSE = 'wss://relay.nostrfeed.com';

describe('withPrimaryFirst', () => {
  it('moves the primary to the front when it is buried in the list', () => {
    const urls = ['wss://a.example', 'wss://b.example', HOUSE];
    expect(withPrimaryFirst(urls, HOUSE)[0]).toBe(HOUSE);
  });

  it('adds the primary when it is missing entirely', () => {
    expect(withPrimaryFirst(['wss://a.example'], HOUSE)).toEqual([
      HOUSE,
      'wss://a.example',
    ]);
  });

  it('does not duplicate the primary', () => {
    const result = withPrimaryFirst([HOUSE, 'wss://a.example'], HOUSE);
    expect(result.filter((url) => url === HOUSE)).toHaveLength(1);
  });

  it('keeps the primary after truncation to the relay cap', () => {
    // The whole point: a long list must not push the primary off the end
    const many = Array.from({ length: 20 }, (_, i) => `wss://r${i}.example`);
    const targets = withPrimaryFirst(many, HOUSE).slice(0, 8);

    expect(targets).toHaveLength(8);
    expect(targets).toContain(HOUSE);
  });

  it('preserves the order of the remaining relays', () => {
    const urls = ['wss://a.example', HOUSE, 'wss://b.example'];
    expect(withPrimaryFirst(urls, HOUSE)).toEqual([
      HOUSE,
      'wss://a.example',
      'wss://b.example',
    ]);
  });

  it('collapses duplicates the config may contain', () => {
    const urls = ['wss://a.example', 'wss://a.example'];
    expect(withPrimaryFirst(urls, HOUSE)).toEqual([HOUSE, 'wss://a.example']);
  });

  it('returns the list unchanged when there is no primary', () => {
    expect(withPrimaryFirst(['wss://a.example'], '')).toEqual([
      'wss://a.example',
    ]);
  });

  it('yields just the primary for an empty list', () => {
    expect(withPrimaryFirst([], HOUSE)).toEqual([HOUSE]);
  });

  it('treats a slashed primary as the one already in the list', () => {
    const result = withPrimaryFirst([HOUSE, 'wss://a.example'], `${HOUSE}/`);
    expect(result).toEqual([HOUSE, 'wss://a.example']);
  });
});

describe('canonicalTargets', () => {
  it('collapses spellings that address the same relay', () => {
    // Each distinct string is a separate websocket, so this is the difference
    // between one connection to nos.lol and three
    expect(
      canonicalTargets(['wss://nos.lol', 'wss://nos.lol/', 'wss://NOS.LOL'])
    ).toEqual(['wss://nos.lol']);
  });

  it('keeps the first occurrence, since order is priority', () => {
    expect(
      canonicalTargets(['wss://a.example', 'wss://b.example', 'wss://a.example/'])
    ).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('drops entries that are not relay URLs at all', () => {
    expect(canonicalTargets(['', '   ', 'wss://a.example'])).toEqual([
      'wss://a.example',
    ]);
  });
});

describe('isIdentityRequest', () => {
  it('recognises a profile lookup', () => {
    expect(isIdentityRequest([{ kinds: [0] }])).toBe(true);
  });

  it('recognises a relay list lookup', () => {
    expect(isIdentityRequest([{ kinds: [10002] }])).toBe(true);
    expect(isIdentityRequest([{ kinds: [0, 10002] }])).toBe(true);
  });

  it('leaves the feed alone', () => {
    // Two extra relays on every page of a timeline is the cost this avoids
    expect(isIdentityRequest([{ kinds: [1, 6, 16, 1068, 30023] }])).toBe(false);
  });

  it('does not qualify a request that only partly asks about identity', () => {
    expect(isIdentityRequest([{ kinds: [0, 1] }])).toBe(false);
    expect(isIdentityRequest([{ kinds: [0] }, { kinds: [1] }])).toBe(false);
  });

  it('ignores a filter with no kinds at all', () => {
    // An id-only lookup could be anything, and fanning it out helps nothing
    expect(isIdentityRequest([{}])).toBe(false);
    expect(isIdentityRequest([])).toBe(false);
  });
});

describe('isZapReceiptRequest', () => {
  it('recognises a query that is only about receipts', () => {
    expect(isZapReceiptRequest([{ kinds: [9735] }])).toBe(true);
  });

  it('leaves note stats alone', () => {
    /*
     * `useNoteStats` fetches replies, reposts, reactions and receipts in one
     * filter per screenful. Widening that would put four more relays behind
     * every page of every feed, to answer a question the page is not asking.
     */
    expect(isZapReceiptRequest([{ kinds: [1, 6, 7, 9735] }])).toBe(false);
  });

  it('does not qualify when anything else is asked alongside', () => {
    expect(isZapReceiptRequest([{ kinds: [9735] }, { kinds: [1] }])).toBe(false);
    expect(isZapReceiptRequest([{ kinds: [9735, 9041] }])).toBe(false);
  });

  it('ignores a filter with no kinds at all', () => {
    expect(isZapReceiptRequest([{}])).toBe(false);
    expect(isZapReceiptRequest([])).toBe(false);
  });
});

describe('RECEIPT_RELAYS', () => {
  it('names relays other clients actually publish zaps to', () => {
    /*
     * The whole point. A receipt is published by the sender's lightning server
     * to the relays named in the sender's zap request — so a zap sent from
     * Damus lands on Damus's relays, and outbox routing cannot help because
     * the filter names no author to route by.
     */
    expect(RECEIPT_RELAYS).toContain('wss://relay.damus.io');
    expect(RECEIPT_RELAYS.length).toBeGreaterThan(1);
  });

  it('lists every relay in canonical form', () => {
    // Anything else opens a second websocket to a relay already connected
    expect(canonicalTargets(RECEIPT_RELAYS)).toEqual(RECEIPT_RELAYS);
  });
});
