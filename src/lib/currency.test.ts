import { describe, it, expect } from 'vitest';
import {
  SATS_PER_BTC,
  btcPrice,
  fiatDigits,
  fiatToSats,
  formatBtcPrice,
  formatFiat,
  guessCurrency,
  isStale,
  normalizeCurrency,
  readCurrencies,
  readRate,
  satsToFiat,
  type FiatRate,
} from './currency';

/** A round hundred thousand dollars a coin, so the arithmetic is checkable. */
const USD: FiatRate = {
  currency: 'USD',
  satsPerUnit: 1000,
  fetchedAt: 1_700_000_000_000,
};

describe('readRate', () => {
  it('reads the single-entry object LNbits answers with', () => {
    expect(readRate({ USD: 862.07 }, 'USD')).toBe(862.07);
  });

  it('matches the key whatever case it comes back in', () => {
    /**
     * The handler echoes the raw path parameter as the key, so asking for
     * `usd` gets `{"usd": ...}` back. A case-sensitive lookup would find
     * nothing and the app would show no price at all.
     */
    expect(readRate({ usd: 1000 }, 'USD')).toBe(1000);
    expect(readRate({ USD: 1000 }, 'usd')).toBe(1000);
  });

  it('accepts a lone entry under an unexpected key', () => {
    expect(readRate({ rate: 1000 }, 'USD')).toBe(1000);
  });

  it('refuses to guess when several keys are present', () => {
    expect(readRate({ USD: 1000, EUR: 900 }, 'GBP')).toBeNull();
  });

  it('treats a zero rate as no rate', () => {
    /**
     * LNbits answers zero when every price source it tries fails. Passing
     * that through divides into Infinity and renders "∞" beside a balance.
     */
    expect(readRate({ USD: 0 }, 'USD')).toBeNull();
    expect(readRate({ USD: -5 }, 'USD')).toBeNull();
  });

  it('rejects anything that is not a usable number', () => {
    expect(readRate({ USD: 'lots' }, 'USD')).toBeNull();
    expect(readRate({ USD: null }, 'USD')).toBeNull();
    expect(readRate(null, 'USD')).toBeNull();
    expect(readRate('nope', 'USD')).toBeNull();
    expect(readRate({}, 'USD')).toBeNull();
  });

  it('reads a numeric string, which JSON has been known to carry', () => {
    expect(readRate({ USD: '1000' }, 'USD')).toBe(1000);
  });
});

describe('conversion', () => {
  it('reports the price per whole coin', () => {
    expect(btcPrice(USD)).toBe(100_000);
    expect(btcPrice(USD)).toBe(SATS_PER_BTC / USD.satsPerUnit);
  });

  it('converts sats to money', () => {
    expect(satsToFiat(1000, USD)).toBe(1);
    expect(satsToFiat(21, USD)).toBeCloseTo(0.021, 6);
    expect(satsToFiat(SATS_PER_BTC, USD)).toBe(100_000);
  });

  it('converts money back to whole sats', () => {
    expect(fiatToSats(1, USD)).toBe(1000);
    expect(fiatToSats(0.0005, USD)).toBe(1);
    // Fractional satoshis are not payable, so this rounds rather than truncates
    expect(fiatToSats(0.00049, USD)).toBe(0);
  });

  it('round-trips an amount within a satoshi', () => {
    const rate: FiatRate = { ...USD, satsPerUnit: 862.0731 };

    for (const sats of [1, 21, 1000, 50_000, 2_100_000]) {
      expect(fiatToSats(satsToFiat(sats, rate), rate)).toBe(sats);
    }
  });
});

describe('fiatDigits', () => {
  it('keeps small amounts from collapsing to zero', () => {
    /**
     * A 21-sat zap is worth about two cents, and somebody asking what 21 sats
     * means is exactly the person two decimals would answer with "$0.00".
     */
    expect(fiatDigits(0.021)).toBe(2);
    expect(fiatDigits(0.0021)).toBe(4);
  });

  it('drops the pennies once they stop mattering', () => {
    expect(fiatDigits(12.5)).toBe(2);
    expect(fiatDigits(1200)).toBe(0);
  });

  it('handles zero and negatives without a long tail', () => {
    expect(fiatDigits(0)).toBe(2);
    expect(fiatDigits(-1500)).toBe(0);
  });
});

describe('formatFiat', () => {
  it('writes a real currency the way that currency is written', () => {
    const formatted = formatFiat(12.5, 'USD', 'en-US');

    expect(formatted).toContain('12.50');
    expect(formatted).toContain('$');
  });

  it('falls back rather than throwing on a code Intl does not know', () => {
    /**
     * Which codes `Intl` accepts differs between browsers and grows over
     * time, and LNbits will happily price things a given browser has never
     * heard of. The throw has to be survivable.
     */
    const formatted = formatFiat(12.5, 'ZZZ');

    expect(formatted).toContain('ZZZ');
    expect(formatted).toContain('12.5');
  });

  it('shows enough digits for a few sats to be visible', () => {
    expect(formatFiat(0.0021, 'USD', 'en-US')).toContain('0.0021');
  });
});

describe('formatBtcPrice', () => {
  it('quotes a whole coin in whole units', () => {
    const formatted = formatBtcPrice(USD, 'en-US');

    expect(formatted).toContain('100,000');
    expect(formatted).not.toContain('.00');
  });

  it('survives a currency Intl cannot format', () => {
    expect(formatBtcPrice({ ...USD, currency: 'ZZZ' })).toContain('ZZZ');
  });
});

describe('normalizeCurrency', () => {
  it('accepts three- and four-letter codes', () => {
    expect(normalizeCurrency(' usd ')).toBe('USD');
    expect(normalizeCurrency('sats')).toBe('SATS');
  });

  it('rejects anything that is not a code', () => {
    expect(normalizeCurrency('')).toBe('');
    expect(normalizeCurrency('US')).toBe('');
    expect(normalizeCurrency('dollars')).toBe('');
    expect(normalizeCurrency('US$')).toBe('');
  });
});

describe('readCurrencies', () => {
  it('cleans, dedupes and sorts the list', () => {
    expect(readCurrencies(['usd', 'EUR', 'USD', ' gbp '])).toEqual([
      'EUR',
      'GBP',
      'USD',
    ]);
  });

  it('drops entries that are not codes', () => {
    expect(readCurrencies(['USD', 42, null, 'nonsense'])).toEqual(['USD']);
  });

  it('answers with nothing for a body that is not a list', () => {
    expect(readCurrencies({ USD: 1 })).toEqual([]);
    expect(readCurrencies(null)).toEqual([]);
  });
});

describe('isStale', () => {
  const now = USD.fetchedAt;

  it('is fresh the moment it is read', () => {
    expect(isStale(USD, now)).toBe(false);
  });

  it('is fresh a few minutes later', () => {
    expect(isStale(USD, now + 10 * 60 * 1000)).toBe(false);
  });

  it('goes stale after the window', () => {
    expect(isStale(USD, now + 31 * 60 * 1000)).toBe(true);
  });
});

describe('guessCurrency', () => {
  it('reads the region out of a locale', () => {
    expect(guessCurrency('en-GB')).toBe('GBP');
    expect(guessCurrency('hi-IN')).toBe('INR');
    expect(guessCurrency('de-DE')).toBe('EUR');
  });

  it('handles a tag carrying a script subtag', () => {
    /**
     * `zh-Hant-TW` split naively on dashes finds "Hant" first, which is not a
     * region — and a two-letter test alone would still miss the real one.
     */
    expect(guessCurrency('zh-Hant-TW')).toBe('TWD');
    expect(guessCurrency('zh-Hans-CN')).toBe('CNY');
  });

  it('falls back to dollars for a bare language', () => {
    expect(guessCurrency('en')).toBe('USD');
  });

  it('falls back for a region with no entry rather than failing', () => {
    expect(guessCurrency('en-AQ')).toBe('USD');
    expect(guessCurrency('!!!')).toBe('USD');
  });
});
