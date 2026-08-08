import { describe, it, expect } from 'vitest';
import {
  daysUntilExpiry,
  describePrice,
  expiresAt,
  formatNip5,
  nip5State,
  nip5WellKnownUrl,
  normalizeLocalPart,
  readClaimedAddress,
  readPaymentHash,
  validateLocalPart,
  yearOptions,
  type Nip5Address,
} from './nip5';

const DAY = 86_400_000;
const NOW = Date.parse('2026-01-01T00:00:00Z');

function address(overrides: Partial<Nip5Address> = {}): Nip5Address {
  return {
    id: 'address-id',
    domain_id: 'domain-id',
    local_part: 'alice',
    pubkey: 'a'.repeat(64),
    active: true,
    ...overrides,
  };
}

describe('validateLocalPart', () => {
  it('accepts the characters NIP-05 allows', () => {
    expect(validateLocalPart('alice')).toBeNull();
    expect(validateLocalPart('alice.the_1st-again')).toBeNull();
  });

  it('refuses an empty name', () => {
    expect(validateLocalPart('')).toBe('empty');
  });

  it('refuses characters that would never verify', () => {
    expect(validateLocalPart('Alice')).toBe('invalid-characters');
    expect(validateLocalPart('a b')).toBe('invalid-characters');
    expect(validateLocalPart('josé')).toBe('invalid-characters');
  });

  it('refuses the underscore that stands for the domain itself', () => {
    // `_@example.com` is how NIP-05 says "this domain"; selling it hands one
    // user the identity of the whole deployment
    expect(validateLocalPart('_')).toBe('reserved');
  });

  it('refuses a name longer than the field allows', () => {
    expect(validateLocalPart('a'.repeat(65))).toBe('too-long');
  });
});

describe('normalizeLocalPart', () => {
  it('lower-cases and drops what is not allowed', () => {
    expect(normalizeLocalPart('Alice Smith!')).toBe('alicesmith');
  });

  it('folds accents rather than deleting the letter', () => {
    expect(normalizeLocalPart('José')).toBe('jose');
  });

  it('caps the length', () => {
    expect(normalizeLocalPart('a'.repeat(200))).toHaveLength(64);
  });
});

describe('formatNip5 and nip5WellKnownUrl', () => {
  it('writes the identifier the way a profile stores it', () => {
    expect(formatNip5('alice', 'nostrfeed.com')).toBe('alice@nostrfeed.com');
  });

  it('points at the file a client actually fetches', () => {
    expect(nip5WellKnownUrl('alice', 'nostrfeed.com')).toBe(
      'https://nostrfeed.com/.well-known/nostr.json?name=alice'
    );
  });
});

describe('expiresAt', () => {
  it('reads an ISO timestamp', () => {
    expect(expiresAt(address({ expires_at: '2027-01-01T00:00:00Z' }))).toBe(
      Date.parse('2027-01-01T00:00:00Z')
    );
  });

  it('returns null when the name does not expire', () => {
    expect(expiresAt(address())).toBeNull();
  });

  it('returns null rather than NaN for an unparseable date', () => {
    // NaN would compare false against every threshold and quietly report a
    // lapsed name as fine
    expect(expiresAt(address({ expires_at: 'soon' }))).toBeNull();
  });
});

describe('daysUntilExpiry', () => {
  it('counts the days left', () => {
    const expiry = new Date(NOW + 10 * DAY).toISOString();

    expect(daysUntilExpiry(address({ expires_at: expiry }), NOW)).toBe(10);
  });

  it('goes negative once it has lapsed', () => {
    const expiry = new Date(NOW - 3 * DAY).toISOString();

    expect(daysUntilExpiry(address({ expires_at: expiry }), NOW)).toBe(-3);
  });

  it('is null for a name with no expiry', () => {
    expect(daysUntilExpiry(address(), NOW)).toBeNull();
  });
});

describe('nip5State', () => {
  it('calls an unpaid name inactive, not expired', () => {
    // These need different fixes: one is waiting on an invoice, the other on
    // a renewal
    expect(nip5State(address({ active: false }), NOW)).toBe('inactive');
  });

  it('reports a lapsed name as expired', () => {
    const expiry = new Date(NOW - DAY).toISOString();

    expect(nip5State(address({ expires_at: expiry }), NOW)).toBe('expired');
  });

  it('warns inside the renewal window', () => {
    const expiry = new Date(NOW + 10 * DAY).toISOString();

    expect(nip5State(address({ expires_at: expiry }), NOW)).toBe('expiring');
  });

  it('says nothing when there is plenty of time', () => {
    const expiry = new Date(NOW + 200 * DAY).toISOString();

    expect(nip5State(address({ expires_at: expiry }), NOW)).toBe('active');
  });

  it('treats a name with no expiry as active', () => {
    expect(nip5State(address(), NOW)).toBe('active');
  });
});

describe('describePrice', () => {
  it('says free when nothing is owed', () => {
    expect(describePrice({ price: 0, price_in_sats: 0 })).toBe('Free');
  });

  it('prices in sats when that is the currency', () => {
    expect(describePrice({ price: 2000, price_in_sats: 2000, currency: 'sats' })).toBe(
      '2,000 sats / year'
    );
  });

  it('shows the fiat price and the sats it converts to', () => {
    expect(
      describePrice({ price: 5, price_in_sats: 8200, currency: 'USD' })
    ).toBe('5.00 USD / year (≈ 8,200 sats)');
  });

  it('names the period when buying several years', () => {
    expect(
      describePrice({ price: 10, price_in_sats: 16400, currency: 'USD' }, 2)
    ).toContain('/ 2 years');
  });

  it('falls back to sats when the currency is missing', () => {
    expect(describePrice({ price_in_sats: 500 })).toBe('500 sats / year');
  });
});

describe('yearOptions', () => {
  it('offers one year by default', () => {
    expect(yearOptions()).toEqual([1]);
  });

  it('offers up to what the domain allows', () => {
    expect(yearOptions(3)).toEqual([1, 2, 3]);
  });

  it('never offers zero years', () => {
    expect(yearOptions(0)).toEqual([1]);
  });
});

describe('readPaymentHash', () => {
  it('reads a hash at the top level', () => {
    expect(readPaymentHash({ payment_hash: 'abc' })).toBe('abc');
  });

  it('reads one nested under extra', () => {
    expect(readPaymentHash({ extra: { payment_hash: 'abc' } })).toBe('abc');
  });

  it('returns nothing for a free name, which has no invoice', () => {
    expect(readPaymentHash({ local_part: 'alice' })).toBeUndefined();
    expect(readPaymentHash(null)).toBeUndefined();
  });
});

describe('readClaimedAddress', () => {
  it('unwraps a response that nests the address', () => {
    expect(readClaimedAddress({ address: address() })?.local_part).toBe('alice');
  });

  it('accepts a response that is the address', () => {
    expect(readClaimedAddress(address())?.local_part).toBe('alice');
  });

  it('returns null for anything else', () => {
    expect(readClaimedAddress({ ok: true })).toBeNull();
    expect(readClaimedAddress(undefined)).toBeNull();
  });
});
