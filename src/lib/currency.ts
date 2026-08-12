/**
 * What a number of sats is actually worth, in money the reader thinks in.
 *
 * Sats are the unit everything here is denominated in, and for most people
 * they mean nothing on their own — "zap 5000" is a number without a size.
 * A fiat figure beside it is the whole difference between a guess and a
 * decision, and it matters most exactly where the stakes are: sending a
 * payment, melting ecash, pricing a listing.
 *
 * The rate comes from LNbits, which aggregates several exchanges behind
 * `GET /api/v1/rate/{currency}` and is already the payments backend, so this
 * adds no new dependency and no new thing to be down.
 */

export const SATS_PER_BTC = 100_000_000;

/** Stored instead of a currency code when somebody wants no fiat at all. */
export const HIDE_FIAT = 'none';

export interface FiatRate {
  /** ISO 4217-ish code, upper case. */
  currency: string;
  /**
   * How many satoshis one unit of the currency buys.
   *
   * This is the direction LNbits reports — its handler is literally named
   * `api_fiat_as_sats` — and it is the opposite of what "rate" suggests to
   * most people, who expect a price per BTC. Getting it backwards does not
   * fail loudly: at a hundred thousand dollars a coin the two readings differ
   * by a factor of a billion, which renders as a plausible-looking number in
   * the wrong place. Hence the name.
   */
  satsPerUnit: number;
  /** Epoch milliseconds when this was read. */
  fetchedAt: number;
}

/**
 * A rate that can be divided by.
 *
 * Zero is rejected as hard as a missing field. LNbits answers with a zero
 * when every upstream provider it tries fails, and a zero here divides into
 * `Infinity` — which formats as "∞" next to a balance and reads as a bug
 * rather than as "we don't know the price right now".
 */
function usableRate(value: unknown): number | null {
  const rate = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Reads the sats-per-unit figure out of `GET /api/v1/rate/{currency}`.
 *
 * The response is a single-entry object keyed by the currency — but keyed by
 * the string *as it was requested*, since the handler echoes the raw path
 * parameter back. So the key is matched case-insensitively rather than looked
 * up directly, and a lone entry is accepted whatever it is called.
 */
export function readRate(body: unknown, currency: string): number | null {
  if (!body || typeof body !== 'object') return null;

  const entries = Object.entries(body as Record<string, unknown>);
  const wanted = currency.trim().toUpperCase();

  for (const [key, value] of entries) {
    if (key.trim().toUpperCase() === wanted) return usableRate(value);
  }

  return entries.length === 1 ? usableRate(entries[0][1]) : null;
}

/** Reads `GET /api/v1/currencies`, which answers with a bare array of codes. */
export function readCurrencies(body: unknown): string[] {
  if (!Array.isArray(body)) return [];

  const codes = body
    .filter((entry): entry is string => typeof entry === 'string')
    .map(normalizeCurrency)
    .filter(Boolean);

  return [...new Set(codes)].sort();
}

/** Upper case, trimmed. Empty for anything that isn't a code at all. */
export function normalizeCurrency(code: string): string {
  const trimmed = code.trim().toUpperCase();
  return /^[A-Z]{3,4}$/.test(trimmed) ? trimmed : '';
}

/** The price of one whole bitcoin, which is the figure people quote. */
export function btcPrice(rate: FiatRate): number {
  return SATS_PER_BTC / rate.satsPerUnit;
}

export function satsToFiat(sats: number, rate: FiatRate): number {
  return sats / rate.satsPerUnit;
}

/** Fiat to sats, rounded — a fractional satoshi is not payable on-chain. */
export function fiatToSats(amount: number, rate: FiatRate): number {
  return Math.round(amount * rate.satsPerUnit);
}

/**
 * How many decimals are worth showing for an amount.
 *
 * Fixed precision breaks at both ends of the range this app spans. Two
 * decimals turns a 21-sat zap into "$0.00" — the exact case where somebody
 * wants the fiat figure most, since 21 sats means nothing to them — while the
 * same two decimals on a balance in rupees produce a long tail of digits
 * nobody reads.
 */
export function fiatDigits(amount: number): number {
  const size = Math.abs(amount);

  if (size >= 1000) return 0;
  if (size >= 1) return 2;
  if (size >= 0.01 || size === 0) return 2;
  return 4;
}

/**
 * An amount of money, written out.
 *
 * `Intl` throws on codes it does not know, and which codes those are differs
 * between browsers and grows over time — so the throw is caught rather than
 * pre-empted by a whitelist that would go stale.
 */
export function formatFiat(
  amount: number,
  currency: string,
  locale?: string
): string {
  const digits = fiatDigits(amount);

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })} ${currency}`;
  }
}

/** "$103,412" — the headline price, always whole units. */
export function formatBtcPrice(rate: FiatRate, locale?: string): string {
  const price = btcPrice(rate);

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: rate.currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `${Math.round(price).toLocaleString(locale)} ${rate.currency}`;
  }
}

/**
 * The currency's own name, for a picker with a hundred and sixty entries in it.
 *
 * `Intl.DisplayNames` returns the code unchanged for anything it does not
 * know, which is the right fallback and saves bundling a name table that
 * would be stale the moment a currency is renamed.
 */
export function currencyLabel(code: string, locale?: string): string {
  try {
    const name = new Intl.DisplayNames(locale ? [locale] : undefined, {
      type: 'currency',
    }).of(code);

    return name && name !== code ? `${code} · ${name}` : code;
  } catch {
    return code;
  }
}

/**
 * Whether a rate is too old to put in front of somebody.
 *
 * A price is a fact with a shelf life. Showing a stale one unmarked is worse
 * than showing none, because it invites a decision — send this, accept that —
 * on a number that has moved.
 */
export function isStale(
  rate: FiatRate,
  now = Date.now(),
  maxAgeMs = 30 * 60 * 1000
): boolean {
  return now - rate.fetchedAt > maxAgeMs;
}

/**
 * The currencies offered first, before the long alphabetical tail.
 *
 * Also the list used when LNbits cannot be reached for the full one, so the
 * picker still works offline rather than collapsing to a single entry.
 */
export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'JPY',
  'CNY',
  'BRL',
  'CAD',
  'AUD',
  'CHF',
  'MXN',
  'NGN',
  'ZAR',
  'KRW',
  'TRY',
  'RUB',
  'ARS',
  'IDR',
  'PHP',
  'SEK',
];

/**
 * Region to currency, for guessing a sensible default.
 *
 * The platform has no such mapping — `Intl` will name a currency but will not
 * tell you which one a country uses — so it is a table, kept to the regions
 * with enough users to be worth the bytes. Everywhere else lands on USD,
 * which is at least the unit bitcoin is usually quoted in.
 */
const REGION_CURRENCY: Record<string, string> = {
  AE: 'AED', AR: 'ARS', AT: 'EUR', AU: 'AUD', BD: 'BDT', BE: 'EUR', BG: 'BGN',
  BR: 'BRL', CA: 'CAD', CH: 'CHF', CL: 'CLP', CN: 'CNY', CO: 'COP', CZ: 'CZK',
  DE: 'EUR', DK: 'DKK', EG: 'EGP', ES: 'EUR', FI: 'EUR', FR: 'EUR', GB: 'GBP',
  GR: 'EUR', HK: 'HKD', HR: 'EUR', HU: 'HUF', ID: 'IDR', IE: 'EUR', IL: 'ILS',
  IN: 'INR', IT: 'EUR', JP: 'JPY', KE: 'KES', KR: 'KRW', LK: 'LKR', MX: 'MXN',
  MY: 'MYR', NG: 'NGN', NL: 'EUR', NO: 'NOK', NZ: 'NZD', PE: 'PEN', PH: 'PHP',
  PK: 'PKR', PL: 'PLN', PT: 'EUR', RO: 'RON', RS: 'RSD', RU: 'RUB', SA: 'SAR',
  SE: 'SEK', SG: 'SGD', TH: 'THB', TR: 'TRY', TW: 'TWD', UA: 'UAH', US: 'USD',
  VN: 'VND', ZA: 'ZAR',
};

/**
 * A first guess at the reader's currency, from the browser's own locale.
 *
 * Only a default — it is overridable in settings, and it has to be, because a
 * locale says which conventions somebody reads by and not which money they
 * hold. Guessing wrong costs them one trip to settings; not guessing at all
 * shows every non-American a price in dollars until they find that setting.
 */
export function guessCurrency(locale?: string): string {
  const tag =
    locale ||
    (typeof navigator !== 'undefined' ? navigator.language : undefined) ||
    'en-US';

  const region = readRegion(tag);
  return (region && REGION_CURRENCY[region]) || 'USD';
}

/** The region subtag, however this browser gets there. */
function readRegion(tag: string): string | undefined {
  try {
    // Available everywhere modern, and correct for tags with a script subtag
    // like `zh-Hant-TW`, which a naive split would read as "Hant"
    const region = new Intl.Locale(tag).region;
    if (region) return region.toUpperCase();
  } catch {
    // Falls through to the manual read
  }

  const parts = tag.split(/[-_]/);
  const region = parts.find((part) => /^[A-Za-z]{2}$/.test(part) && part !== parts[0]);
  return region?.toUpperCase();
}
