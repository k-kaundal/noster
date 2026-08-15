import { describe, it, expect } from 'vitest';
import {
  NIP5_DOMAIN,
  buildLnAddressBody,
  daysUntilExpiry,
  describePrice,
  expiresAt,
  formatNip5,
  isLnAddressPending,
  isZappable,
  lnAddressConfig,
  nip5Identifier,
  nip5State,
  nip5WellKnownUrl,
  parseNip5Domains,
  normalizeLocalPart,
  normalizePromoCode,
  promoOutcome,
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

describe('normalizePromoCode', () => {
  it('takes what somebody actually types', () => {
    /**
     * These are read off a poster or a message, so they arrive with spaces,
     * in the wrong case, sometimes inside quotes. All of those name a real
     * code and all of them fail an exact comparison on the server, which then
     * answers as though the code were fake.
     */
    expect(normalizePromoCode('  launch  ')).toBe('LAUNCH');
    expect(normalizePromoCode('"LAUNCH"')).toBe('LAUNCH');
    expect(normalizePromoCode("'launch'")).toBe('LAUNCH');
  });

  it('leaves an empty field empty', () => {
    expect(normalizePromoCode('   ')).toBe('');
  });
});

describe('promoOutcome', () => {
  it('reads a discount as the difference between quoted and charged', () => {
    expect(
      promoOutcome({ price_in_sats: 10_000 }, { price_in_sats: 7_500 })
    ).toEqual({ applied: true, savedSats: 2_500 });
  });

  it('says nothing happened when the price did not move', () => {
    /**
     * The direction that matters. The server ignores a code it does not know
     * rather than refusing the claim, so a wrong code produces a full-price
     * invoice — and claiming "discount applied" over it would have somebody
     * pay full price believing otherwise.
     */
    expect(
      promoOutcome({ price_in_sats: 10_000 }, { price_in_sats: 10_000 }).applied
    ).toBe(false);
  });

  it('never reads a higher price as a discount', () => {
    expect(
      promoOutcome({ price_in_sats: 10_000 }, { price_in_sats: 12_000 }).applied
    ).toBe(false);
  });

  it('falls back to the currency figure when sats are missing', () => {
    // Applied without an amount, since "your code did nothing" is the one
    // wrong answer available here
    expect(promoOutcome({ price: 10 }, { price: 8 })).toEqual({
      applied: true,
    });
  });

  it('answers safely when either side is unknown', () => {
    expect(promoOutcome(null, { price_in_sats: 100 }).applied).toBe(false);
    expect(promoOutcome({ price_in_sats: 100 }, null).applied).toBe(false);
    expect(promoOutcome({}, {}).applied).toBe(false);
  });
});

describe('buildLnAddressBody', () => {
  it('names the wallet it was given', () => {
    expect(buildLnAddressBody({ walletId: 'wallet-2' }).wallet).toBe('wallet-2');
  });

  it('fills in limits that let a payment through', () => {
    expect(buildLnAddressBody({ walletId: 'w' })).toEqual({
      wallet: 'w',
      min: 1,
      max: 10_000_000,
    });
  });

  it('never builds an address that refuses everything', () => {
    // A maximum under the minimum resolves and looks healthy from the
    // outside, then rejects every payment sent to it
    const body = buildLnAddressBody({ walletId: 'w', minSats: 500, maxSats: 10 });
    expect(body.min).toBe(500);
    expect(body.max).toBe(500);
  });

  it('refuses a zero or fractional floor', () => {
    expect(buildLnAddressBody({ walletId: 'w', minSats: 0 }).min).toBe(1);
    expect(buildLnAddressBody({ walletId: 'w', minSats: 2.4 }).min).toBe(2);
  });
});

describe('lnAddressConfig', () => {
  it('reads the wallet a name pays into', () => {
    expect(
      lnAddressConfig({ extra: { ln_address: { wallet: 'w1', min: 1, max: 10 } } })
    ).toEqual({ wallet: 'w1', min: 1, max: 10 });
  });

  it('treats an empty wallet as no address at all', () => {
    // The extension stores the shape on every address whether or not one was
    // ever set up, so its presence proves nothing
    expect(lnAddressConfig({ extra: { ln_address: { wallet: '' } } })).toBeNull();
    expect(lnAddressConfig({ extra: {} })).toBeNull();
    expect(lnAddressConfig(null)).toBeNull();
  });
});

describe('isLnAddressPending', () => {
  it('names the half-finished state instead of guessing at it', () => {
    /**
     * Not "no address" — somebody chose a wallet — and not a working one, so
     * a person told either of those is told something false.
     */
    expect(
      isLnAddressPending({ extra: { ln_address: { wallet: 'w1' } } })
    ).toBe(true);
    expect(
      isLnAddressPending({
        extra: { ln_address: { wallet: 'w1', pay_link_id: 'p1' } },
      })
    ).toBe(false);
    expect(isLnAddressPending({ extra: { ln_address: { wallet: '' } } })).toBe(
      false
    );
    expect(isLnAddressPending(undefined)).toBe(false);
  });
});

describe('isZappable', () => {
  it('is true only when payments actually have somewhere to land', () => {
    /**
     * `wallet` is the request and `pay_link_id` is the pay link LNbits made to
     * honour it. Only the second means money can arrive, and reading the first
     * alone is how the wallet page announced that a name "receives payments"
     * when nothing had ever been created for it.
     */
    expect(
      isZappable({ extra: { ln_address: { wallet: 'w1', pay_link_id: 'p1' } } })
    ).toBe(true);
    expect(isZappable({ extra: { ln_address: { wallet: 'w1' } } })).toBe(false);
    expect(isZappable({ extra: { ln_address: { wallet: '' } } })).toBe(false);
    expect(isZappable(undefined)).toBe(false);
  });
});

describe('parseNip5Domains', () => {
  it('reads id and hostname pairs', () => {
    expect(parseNip5Domains('abc123:nostrfeed.com, def456:zap.example')).toEqual([
      { id: 'abc123', domain: 'nostrfeed.com' },
      { id: 'def456', domain: 'zap.example' },
    ]);
  });

  it('reads a pair written the other way round', () => {
    // The half with a dot is the hostname; a domain id never has one
    expect(parseNip5Domains('nostrfeed.com:abc123')).toEqual([
      { id: 'abc123', domain: 'nostrfeed.com' },
    ]);
  });

  it('accepts either separator, and whitespace between entries', () => {
    expect(parseNip5Domains('a1=one.example  b2:two.example')).toEqual([
      { id: 'a1', domain: 'one.example' },
      { id: 'b2', domain: 'two.example' },
    ]);
  });

  it('lower-cases the hostname, which is compared against profile fields', () => {
    expect(parseNip5Domains('a1:NostrFeed.com')[0].domain).toBe('nostrfeed.com');
  });

  it('drops an entry missing either half', () => {
    // An id alone cannot be named on screen and a hostname alone cannot be
    // queried, so neither is a domain we can sell under
    expect(parseNip5Domains('abc123')).toEqual([]);
    expect(parseNip5Domains('one.example')).toEqual([]);
    expect(parseNip5Domains('')).toEqual([]);
    expect(parseNip5Domains(undefined)).toEqual([]);
  });

  it('keeps the first of a repeated id, so ordering cannot be hijacked', () => {
    expect(parseNip5Domains('a1:one.example,a1:two.example')).toEqual([
      { id: 'a1', domain: 'one.example' },
    ]);
  });
});

describe('nip5Identifier', () => {
  /**
   * The domain a name is bought under is the domain it has to be named at: a
   * `nip05` pointing at the wrong host fails verification silently, so the ✓
   * simply never appears. Which host each id maps to comes from configuration,
   * so that half is covered by `parseNip5Domains` above — these cover what
   * happens either side of a successful lookup.
   */
  it('falls back to the default domain for an unknown one', () => {
    expect(nip5Identifier({ local_part: 'alice', domain_id: 'nope' })).toBe(
      `alice@${NIP5_DOMAIN}`
    );
  });

  it('has nothing to say about a missing address', () => {
    expect(nip5Identifier(null)).toBeNull();
    expect(nip5Identifier(undefined)).toBeNull();
  });
});
