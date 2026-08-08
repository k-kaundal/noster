import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  MAX_ZAP_RELAYS,
  ZAP_REQUEST_KIND,
  addressPointerFor,
  buildZapRequest,
  describeZapTarget,
  lightningAddressUrl,
  zapCallbackUrl,
} from './zapRequest';

const ALICE = 'a'.repeat(64);

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'id',
    pubkey: ALICE,
    kind: 1,
    content: '',
    tags: [],
    created_at: 1000,
    sig: '',
    ...overrides,
  };
}

describe('lightningAddressUrl', () => {
  it('resolves an address to its well-known path', () => {
    expect(lightningAddressUrl('alice@example.com')).toBe(
      'https://example.com/.well-known/lnurlp/alice'
    );
  });

  it('trims what someone pasted', () => {
    expect(lightningAddressUrl('  alice@example.com ')).toBe(
      'https://example.com/.well-known/lnurlp/alice'
    );
  });

  it('uses http for an onion host, as LUD-16 requires', () => {
    expect(lightningAddressUrl('alice@abcd.onion')).toBe(
      'http://abcd.onion/.well-known/lnurlp/alice'
    );
  });

  it('refuses anything that is not an address', () => {
    // A malformed lud16 should fail here, not produce a request to a URL
    // assembled out of nonsense
    expect(lightningAddressUrl('not-an-address')).toBeNull();
    expect(lightningAddressUrl('alice@')).toBeNull();
    expect(lightningAddressUrl('@example.com')).toBeNull();
    expect(lightningAddressUrl('a@b')).toBeNull();
  });

  it('refuses a name or host with a path separator in it', () => {
    expect(lightningAddressUrl('a/../b@example.com')).toBeNull();
    expect(lightningAddressUrl('alice@example.com/evil')).toBeNull();
  });
});

describe('addressPointerFor', () => {
  it('builds the coordinate of an addressable event', () => {
    const article = event({ kind: 30023, tags: [['d', 'my-post']] });

    expect(addressPointerFor(article)).toBe(`30023:${ALICE}:my-post`);
  });

  it('handles an addressable event with no identifier', () => {
    expect(addressPointerFor(event({ kind: 30023 }))).toBe(`30023:${ALICE}:`);
  });

  it('returns nothing for a plain note, which is zapped by id', () => {
    expect(addressPointerFor(event({ kind: 1 }))).toBeNull();
  });
});

describe('buildZapRequest', () => {
  const base = {
    recipientPubkey: ALICE,
    amountMsat: 21_000,
    relays: ['wss://relay.one', 'wss://relay.two'],
    createdAt: 1000,
  };

  it('carries the amount in millisats and the recipient', () => {
    const request = buildZapRequest(base);

    expect(request.kind).toBe(ZAP_REQUEST_KIND);
    expect(request.tags).toContainEqual(['amount', '21000']);
    expect(request.tags).toContainEqual(['p', ALICE]);
  });

  it('names the relays in one tag, as the spec has it', () => {
    expect(buildZapRequest(base).tags[0]).toEqual([
      'relays',
      'wss://relay.one',
      'wss://relay.two',
    ]);
  });

  it('drops anything that is not a relay URL', () => {
    const request = buildZapRequest({
      ...base,
      relays: ['wss://relay.one', 'https://example.com', ''],
    });

    expect(request.tags[0]).toEqual(['relays', 'wss://relay.one']);
  });

  it('caps the relay list, which some servers reject when it is long', () => {
    const many = Array.from({ length: 20 }, (_, i) => `wss://relay${i}.example`);
    const request = buildZapRequest({ ...base, relays: many });

    expect(request.tags[0]).toHaveLength(MAX_ZAP_RELAYS + 1);
  });

  it('puts the message in the content, where NIP-57 carries it', () => {
    expect(buildZapRequest({ ...base, comment: ' nice post ' }).content).toBe(
      'nice post'
    );
  });

  it('references a note by id', () => {
    const request = buildZapRequest({ ...base, eventId: 'note-1' });

    expect(request.tags).toContainEqual(['e', 'note-1']);
  });

  it('references an article by coordinate instead of by id', () => {
    // Sending both would have the receipt attach itself to two things
    const request = buildZapRequest({
      ...base,
      eventId: 'note-1',
      addressPointer: `30023:${ALICE}:my-post`,
    });

    expect(request.tags).toContainEqual(['a', `30023:${ALICE}:my-post`]);
    expect(request.tags.some(([name]) => name === 'e')).toBe(false);
  });

  it('includes the lnurl when it is known', () => {
    const request = buildZapRequest({ ...base, lnurl: 'lnurl1abc' });

    expect(request.tags).toContainEqual(['lnurl', 'lnurl1abc']);
  });
});

describe('zapCallbackUrl', () => {
  const signed = event({ kind: 9734 });

  it('appends to a callback that already has parameters', () => {
    // LNbits' callback carries a link id; assuming ours is first produces a
    // URL with two question marks
    const url = new URL(
      zapCallbackUrl('https://x/cb?id=7', 21_000, signed)
    );

    expect(url.searchParams.get('id')).toBe('7');
    expect(url.searchParams.get('amount')).toBe('21000');
  });

  it('carries the signed request', () => {
    const url = new URL(zapCallbackUrl('https://x/cb', 21_000, signed));

    expect(JSON.parse(url.searchParams.get('nostr')!).kind).toBe(9734);
  });

  it('leaves out the lnurl when there is none', () => {
    const url = new URL(zapCallbackUrl('https://x/cb', 1000, signed));

    expect(url.searchParams.has('lnurl')).toBe(false);
  });
});

describe('describeZapTarget', () => {
  it('passes a profile with a good address', () => {
    expect(describeZapTarget({ lud16: 'alice@example.com' })).toBeNull();
  });

  it('explains a profile with no address at all', () => {
    expect(describeZapTarget({})).toMatch(/lightning address/i);
  });

  it('names the bad address rather than saying "invalid"', () => {
    expect(describeZapTarget({ lud16: 'nonsense' })).toContain('nonsense');
  });

  it('accepts an lnurl-only profile, which resolves differently', () => {
    expect(describeZapTarget({ lud06: 'lnurl1abc' })).toBeNull();
  });
});
