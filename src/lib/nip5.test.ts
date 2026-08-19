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
  attachedWalletIsForeign,
  defaultAttachWallet,
  outstandingPaymentHash,
  formatAmount,
  findNamePayment,
  forgetNip5Invoice,
  priceBreakdown,
  promoClaimHint,
  rememberNip5Invoice,
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
  it('drops what nobody meant to type', () => {
    /**
     * These are read off a poster or a message, so they arrive with spaces and
     * sometimes inside quotes. Neither was typed on purpose, and both fail the
     * server's comparison — which then answers as though the code were fake.
     */
    expect(normalizePromoCode('  LAUNCH  ')).toBe('LAUNCH');
    expect(normalizePromoCode('"LAUNCH"')).toBe('LAUNCH');
    expect(normalizePromoCode("'LAUNCH'")).toBe('LAUNCH');
  });

  it('leaves the case exactly as typed', () => {
    /**
     * The extension compares `promotion.code == promo_code` with no folding of
     * any kind. Uppercasing here made a code written as `spring24` impossible
     * to redeem however carefully it was typed.
     */
    expect(normalizePromoCode('spring24')).toBe('spring24');
    expect(normalizePromoCode('Spring24')).toBe('Spring24');
  });

  it('keeps a referrer attached to the code', () => {
    // The server splits `CODE@name` itself, and the half after the `@` names
    // somebody's identifier
    expect(normalizePromoCode(' NEW100@alice ')).toBe('NEW100@alice');
  });

  it('leaves an empty field empty', () => {
    expect(normalizePromoCode('   ')).toBe('');
  });
});

describe('priceBreakdown', () => {
  it('reads a discount as the difference between quoted and charged', () => {
    expect(
      priceBreakdown({ price_in_sats: 10_000 }, { price_in_sats: 7_500 }, 'LAUNCH')
    ).toMatchObject({
      promo: 'applied',
      code: 'LAUNCH',
      checked: false,
      unit: 'sats',
      list: 10_000,
      paid: 7_500,
      saved: 2_500,
      savedPercent: 25,
    });
  });

  it('says a code did nothing when the price did not move', () => {
    /**
     * The direction that matters. The extension ignores a code it does not
     * know rather than refusing the claim, so a wrong code produces a
     * full-price invoice — and silence over it has somebody pay full price
     * believing otherwise.
     */
    expect(
      priceBreakdown({ price_in_sats: 10_000 }, { price_in_sats: 10_000 }, 'nope')
        .promo
    ).toBe('ignored');
  });

  it('never reads a higher price as a discount', () => {
    const price = priceBreakdown(
      { price_in_sats: 10_000 },
      { price_in_sats: 12_000 },
      'LAUNCH'
    );

    expect(price.promo).toBe('ignored');
    expect(price.saved).toBeUndefined();
  });

  it('reports nothing about a code nobody typed', () => {
    expect(
      priceBreakdown({ price_in_sats: 10_000 }, { price_in_sats: 10_000 }).promo
    ).toBe('none');
  });

  it('takes the code the server recorded when none was typed here', () => {
    // A reservation reopened later still knows which code paid for it
    expect(
      priceBreakdown(
        { price_in_sats: 10_000 },
        { price_in_sats: 8_000, promo_code: 'EARLY' }
      )
    ).toMatchObject({ promo: 'applied', code: 'EARLY' });
  });

  it('falls back to the currency figure when neither side quotes sats', () => {
    expect(priceBreakdown({ price: 10, currency: 'eur' }, { price: 8 }, 'x'))
      .toMatchObject({ promo: 'applied', unit: 'eur', saved: 2 });
  });

  it('admits ignorance rather than guessing', () => {
    /**
     * With nothing to compare against, a code may well have worked. Saying it
     * did not would be a guess presented as a finding — which is the same
     * failure as silence, pointed the other way.
     */
    expect(priceBreakdown(null, { price_in_sats: 100 }, 'x').promo).toBe('unknown');
    expect(priceBreakdown({ price_in_sats: 100 }, null, 'x').promo).toBe('unknown');
    expect(priceBreakdown({}, {}, 'x').promo).toBe('unknown');
  });

  it('does not complain about a code on a name that costs nothing', () => {
    // There is no discount to fail to apply to zero
    expect(
      priceBreakdown({ price_in_sats: 0 }, { price_in_sats: 0 }, 'LAUNCH').promo
    ).toBe('none');
  });

  it('still reports what is owed when nothing was ever quoted', () => {
    // The invoice is the half that always exists, and it is the half that
    // matters most on a screen asking for money
    expect(priceBreakdown(null, { price_in_sats: 900 })).toMatchObject({
      promo: 'none',
      paid: 900,
      list: undefined,
    });
  });

  it('takes the server at its word over the arithmetic', () => {
    /**
     * `buyer_discount` is the extension answering for the code directly: it
     * looks the promotion up and reports the percent, or zero when it has
     * none. Everything else here is a reading of two numbers.
     */
    const price = priceBreakdown(
      { price_in_sats: 10_000 },
      { price_in_sats: 8_500 },
      'SPRING',
      { buyer_discount: 15 }
    );

    expect(price).toMatchObject({ promo: 'applied', checked: true });
    /*
     * 15, not the 15-ish that dividing rounded sats gives back. The stated
     * percent is the figure the promotion was written with.
     */
    expect(price.savedPercent).toBe(15);
  });

  it('calls a code the server does not know exactly that', () => {
    /**
     * The direction that matters, and the reason this field is worth reading.
     * The extension ignores a code it has no promotion for rather than
     * refusing the claim, so nothing else distinguishes a dead code from a
     * live one — the reservation succeeds and the invoice is raised either way.
     */
    const price = priceBreakdown(
      { price_in_sats: 10_000 },
      { price_in_sats: 10_000 },
      'NOPE',
      { buyer_discount: 0 }
    );

    expect(price).toMatchObject({ promo: 'ignored', checked: true });
  });

  it('knows a code worked with nothing to compare it against', () => {
    /**
     * A reservation reopened days later has no quote beside it, and the
     * extension stores only the price after the discount — so without the
     * stated percent this was `unknown`, on the one screen asking for money.
     */
    const price = priceBreakdown(null, { price_in_sats: 8_000 }, 'SPRING', {
      buyer_discount: 20,
    });

    expect(price.promo).toBe('applied');
    // The list price, put back from the percent: 8,000 is the 80% that was paid
    expect(price.list).toBe(10_000);
    expect(price.saved).toBe(2_000);
  });

  it('does not divide by zero reconstructing a full-value code', () => {
    // 100% off leaves no list price to recover, and the extension refuses such
    // a reservation anyway
    expect(
      priceBreakdown(null, { price_in_sats: 0 }, 'FREE', { buyer_discount: 100 })
        .list
    ).toBeUndefined();
  });

  it('says nothing about a status carrying no code', () => {
    // Every address comes back with a `promo_code_status`, code or not
    expect(
      priceBreakdown({ price_in_sats: 10_000 }, { price_in_sats: 10_000 }, '', {
        buyer_discount: 0,
      })
    ).toMatchObject({ promo: 'none', checked: false });
  });
});

describe('promoClaimHint', () => {
  it('blames the code for a price it took to zero', () => {
    /**
     * A 100% code makes the price falsy, and the extension asserts on that
     * before raising an invoice — so the reservation fails with a message
     * about the *name*, and nothing anywhere suggests dropping the code.
     */
    expect(
      promoClaimHint("Cannot compute price for 'kkworld'.", 'NEW100')
    ).toMatch(/without the code/i);
  });

  it('stays out of the way of every other failure', () => {
    expect(promoClaimHint('Identifier not available.', 'NEW100')).toBeNull();
    expect(
      promoClaimHint("Cannot compute price for 'kkworld'.", undefined)
    ).toBeNull();
  });
});

describe('formatAmount', () => {
  it('writes sats as whole sats', () => {
    expect(formatAmount(2_500.4, 'sats')).toBe('2,500 sats');
  });

  it('writes a currency to the cent', () => {
    expect(formatAmount(9.5, 'eur')).toBe('9.50 EUR');
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

/** A `Storage` that lives in a variable, since these run without a browser. */
function fakeStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  } as unknown as Storage;
}

describe('outstandingPaymentHash', () => {
  const unpaid = (extra: Record<string, unknown> = {}) => ({
    id: 'address-1',
    active: false,
    extra: { payment_hash: 'abc123', ...extra },
  });

  it('finds the invoice an unpaid name is waiting on', () => {
    expect(outstandingPaymentHash(unpaid(), null)).toBe('abc123');
  });

  it('answers nothing once the name is live', () => {
    expect(
      outstandingPaymentHash({ ...unpaid(), active: true }, null)
    ).toBeUndefined();
  });

  it('answers nothing when no invoice was ever raised', () => {
    // A free name settles immediately and carries no hash
    expect(
      outstandingPaymentHash({ id: 'a', active: false, extra: {} }, null)
    ).toBeUndefined();
    expect(
      outstandingPaymentHash(
        { id: 'a', active: false, extra: { payment_hash: '' } },
        null
      )
    ).toBeUndefined();
  });

  it('falls back to the invoice we kept ourselves', () => {
    /**
     * The reason this fallback exists. `extra.payment_hash` is written by
     * `activate_address` and by nothing else, so it is empty for the entire
     * window it is being read in — a reservation waiting to be paid has no
     * hash on the server at all, and a reload used to lose the only copy.
     */
    const storage = fakeStorage();
    rememberNip5Invoice('address-1', 'kept-hash', storage);

    expect(
      outstandingPaymentHash({ id: 'address-1', active: false }, storage)
    ).toBe('kept-hash');
  });

  it('drops what it kept once the name is live', () => {
    const storage = fakeStorage();
    rememberNip5Invoice('address-1', 'kept-hash', storage);
    forgetNip5Invoice('address-1', storage);

    expect(
      outstandingPaymentHash({ id: 'address-1', active: false }, storage)
    ).toBeUndefined();
  });

  it('survives a store that refuses to be written to', () => {
    // Private modes and full quotas both throw here, and losing the recovery
    // path must not lose the purchase
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;

    expect(() => rememberNip5Invoice('a', 'b', broken)).not.toThrow();
    expect(
      outstandingPaymentHash({ id: 'a', active: false }, broken)
    ).toBeUndefined();
  });

  it('answers nothing for a missing address', () => {
    expect(outstandingPaymentHash(null, null)).toBeUndefined();
    expect(outstandingPaymentHash(undefined, null)).toBeUndefined();
  });
});

describe('findNamePayment', () => {
  const now = Date.UTC(2026, 7, 19, 12, 0, 0);
  const anHourAgo = now - 3_600_000;

  /** As the wallet ledger records paying for a name. */
  const bought = (over: Record<string, unknown> = {}) => ({
    amount: -2_100_000,
    status: 'success',
    memo: 'Payment of 2100 sats for NIP-05 kkworld@ln.nostrfeed.com',
    time: new Date(anHourAgo).toISOString(),
    ...over,
  });

  it('finds money already spent on this name', () => {
    /**
     * The extension writes the identifier into the memo of the invoice it
     * raises, which makes their own ledger a second, durable answer to "has
     * this been paid for" — and the only one that works when the extension's
     * payment route refuses to answer.
     */
    expect(
      findNamePayment('kkworld@ln.nostrfeed.com', [bought()], 60_000, now)
    ).toBeDefined();
  });

  it('does not read a refund as a purchase', () => {
    // Reimbursement comes back the other way with a memo just as similar
    expect(
      findNamePayment(
        'kkworld@ln.nostrfeed.com',
        [
          bought({
            amount: 2_100_000,
            memo: 'Reimbursement for NIP-05 for kkworld@ln.nostrfeed.com',
          }),
        ],
        60_000,
        now
      )
    ).toBeUndefined();
  });

  it('ignores a payment that has not settled', () => {
    expect(
      findNamePayment(
        'kkworld@ln.nostrfeed.com',
        [bought({ status: 'pending' })],
        60_000,
        now
      )
    ).toBeUndefined();
  });

  it('ignores a payment for somebody else’s name', () => {
    expect(
      findNamePayment('kkworld@ln.nostrfeed.com', [bought({
        memo: 'Payment of 2100 sats for NIP-05 alice@ln.nostrfeed.com',
      })], 60_000, now)
    ).toBeUndefined();
  });

  it('gives activation a moment before calling a payment stuck', () => {
    /*
     * Activation happens in the same breath as the payment settling, so a
     * payment from ten seconds ago says nothing yet — and reporting it as
     * stuck would flash "we have your money and the name is not live" at
     * everybody who pays normally.
     */
    expect(
      findNamePayment(
        'kkworld@ln.nostrfeed.com',
        [bought({ time: new Date(now - 10_000).toISOString() })],
        60_000,
        now
      )
    ).toBeUndefined();
  });

  it('treats a payment it cannot date as long settled', () => {
    // An unreadable timestamp is one that has had every chance to be acted on
    expect(
      findNamePayment(
        'kkworld@ln.nostrfeed.com',
        [bought({ time: undefined })],
        60_000,
        now
      )
    ).toBeDefined();
  });

  it('answers nothing without a name or a ledger', () => {
    expect(findNamePayment(null, [bought()], 60_000, now)).toBeUndefined();
    expect(
      findNamePayment('kkworld@ln.nostrfeed.com', null, 60_000, now)
    ).toBeUndefined();
  });
});

describe('a name pointed at somebody else’s wallet', () => {
  const attached = (wallet: string) => ({
    extra: { ln_address: { wallet, pay_link_id: 'link-1' } },
  });

  const mine = ['wallet-a', 'wallet-b'];

  it('spots a wallet this account does not have', () => {
    // The id outlives the account that owned it, and sending it back is what
    // makes the extension raise and answer a bare 500
    expect(attachedWalletIsForeign(attached('someone-elses'), mine)).toBe(true);
  });

  it('accepts a wallet the account holds', () => {
    expect(attachedWalletIsForeign(attached('wallet-b'), mine)).toBe(false);
  });

  it('says nothing about a name with no wallet at all', () => {
    expect(attachedWalletIsForeign({ extra: {} }, mine)).toBe(false);
    expect(attachedWalletIsForeign(null, mine)).toBe(false);
  });

  it('does not accuse anything while the wallet list is still empty', () => {
    // Wallets arrive from a query; an empty list is "not yet", not "not yours"
    expect(attachedWalletIsForeign(attached('wallet-a'), [])).toBe(true);
  });

  it('keeps a usable stored wallet as the default', () => {
    expect(defaultAttachWallet(attached('wallet-b'), mine)).toBe('wallet-b');
  });

  it('never defaults to a foreign wallet', () => {
    // Defaulting to it is how the dead id got resent on every retry
    expect(defaultAttachWallet(attached('someone-elses'), mine)).toBe('wallet-a');
  });

  it('falls back to the first wallet when none is stored', () => {
    expect(defaultAttachWallet({ extra: {} }, mine)).toBe('wallet-a');
  });

  it('answers empty when there is nothing to choose', () => {
    expect(defaultAttachWallet({ extra: {} }, [])).toBe('');
  });
});
