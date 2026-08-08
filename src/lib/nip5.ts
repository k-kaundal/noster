/**
 * NIP-05 identifiers issued by the LNbits `nostrnip5` extension.
 *
 * This is a different thing from the lightning address in `lightningAddress.ts`,
 * and the two are easy to confuse because they look identical when written down.
 *
 * - A **lightning address** (LUD-16) is an `lnurlp` pay link with a username on
 *   it. It is free, it never expires, and it only means "send money here". The
 *   profile field is `lud16`.
 * - A **NIP-05 identifier** is a name your Nostr identity verifies against. It
 *   is sold by the year, it has an expiry, and it is what other clients render
 *   the ✓ next to. The profile field is `nip05`.
 *
 * The extension can also attach a lightning address to an identifier, so one
 * name does both jobs — that is what `LnAddressConfig` on an address is for.
 *
 * Everything about the price comes from the server. The extension prices names
 * by character count, by rank, and by promotion, and it can hand out a limited
 * number for free; reimplementing any of that here would produce a number that
 * disagrees with the invoice.
 */
import { ADDRESS_DOMAIN } from '@/lib/lightningAddress';

/**
 * The domain to sell names under, as the extension's own id for it.
 *
 * There is no public endpoint that lists domains — `GET /nostrnip5/api/v1/domains`
 * wants an admin API key — so the id has to be configuration. Left unset, the
 * whole feature stays hidden rather than offering a name it cannot deliver.
 */
export const NIP5_DOMAIN_ID = (import.meta.env.VITE_NIP5_DOMAIN_ID || '').trim();

/**
 * The domain those names read as.
 *
 * Also configuration, for the same reason: the id above is a UUID, and nothing
 * we can read without an admin key maps it back to a hostname. Defaults to the
 * lightning address domain, which is right whenever the operator sells both
 * under one name.
 */
export const NIP5_DOMAIN =
  (import.meta.env.VITE_NIP5_DOMAIN || '').trim() || ADDRESS_DOMAIN;

/** Whether the operator has set up the extension for this deployment. */
export function isNip5Configured(): boolean {
  return !!NIP5_DOMAIN_ID;
}

/** How many years the extension will sell at once, absent a domain saying otherwise. */
export const DEFAULT_MAX_YEARS = 1;

/** A lightning address bolted onto a NIP-05 identifier. */
export interface Nip5LnAddressConfig {
  wallet?: string;
  min?: number;
  max?: number;
  pay_link_id?: string;
}

/** The `AddressExtra` half of an address: what was paid, and for how long. */
export interface Nip5AddressExtra {
  price?: number;
  price_in_sats?: number;
  currency?: string;
  payment_hash?: string;
  years?: number;
  max_years?: number;
  relays?: string[];
  ln_address?: Nip5LnAddressConfig;
}

/** An identifier owned by an account, as `Address` in the extension's schema. */
export interface Nip5Address {
  id: string;
  domain_id: string;
  local_part: string;
  pubkey: string;
  active: boolean;
  is_free?: boolean;
  is_locked?: boolean;
  /** ISO 8601. Absent on a free or never-expiring name. */
  expires_at?: string;
  time?: string;
  extra?: Nip5AddressExtra;
}

/** What the search endpoint says about one name, for a given number of years. */
export interface Nip5AddressStatus {
  identifier: string;
  available: boolean;
  price?: number;
  price_in_sats?: number;
  /** Why it costs that, e.g. a character-count or rank rule. */
  price_reason?: string;
  currency?: string;
  free_identifier_number?: number;
}

/** The body for buying a name. */
export interface Nip5ClaimRequest {
  domain_id: string;
  local_part: string;
  pubkey: string;
  years: number;
  relays?: string[];
  promo_code?: string;
  referer?: string;
  create_invoice?: boolean;
}

/**
 * NIP-05 restricts the local part to `a-z0-9-_.`, the same set LUD-16 allows,
 * so a name can serve as both. Validated separately anyway, because the two
 * specs are free to drift and a shared validator would hide it when they do.
 */
const LOCAL_PART = /^[a-z0-9-_.]+$/;

export const MIN_LOCAL_PART_LENGTH = 1;
export const MAX_LOCAL_PART_LENGTH = 64;

export type LocalPartProblem =
  | 'empty'
  | 'too-long'
  | 'invalid-characters'
  | 'reserved'
  | null;

/**
 * Why a name can't be bought, or null when it can.
 *
 * `_` is refused because NIP-05 gives it a special meaning: `_@example.com` is
 * how a client says "the domain itself". Selling it to one user would let them
 * answer for the whole domain.
 */
export function validateLocalPart(localPart: string): LocalPartProblem {
  if (localPart.length < MIN_LOCAL_PART_LENGTH) return 'empty';
  if (localPart.length > MAX_LOCAL_PART_LENGTH) return 'too-long';
  if (!LOCAL_PART.test(localPart)) return 'invalid-characters';
  if (localPart === '_') return 'reserved';
  return null;
}

export function describeLocalPartProblem(problem: LocalPartProblem): string {
  switch (problem) {
    case 'empty':
      return 'Pick a name.';
    case 'too-long':
      return `At most ${MAX_LOCAL_PART_LENGTH} characters.`;
    case 'invalid-characters':
      return 'Lowercase letters, numbers, dots, dashes and underscores only.';
    case 'reserved':
      return 'That one is reserved for the domain itself.';
    default:
      return '';
  }
}

/** Folds anything typed into something a name can actually be. */
export function normalizeLocalPart(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-_.]+/g, '')
    .slice(0, MAX_LOCAL_PART_LENGTH);
}

/** The identifier as it goes into a profile's `nip05` field. */
export function formatNip5(localPart: string, domain = NIP5_DOMAIN): string {
  return `${localPart}@${domain}`;
}

/** Where a client will check the identifier. */
export function nip5WellKnownUrl(
  localPart: string,
  domain = NIP5_DOMAIN
): string {
  return `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(localPart)}`;
}

/** Expiry as epoch milliseconds, or null when the name does not expire. */
export function expiresAt(address: Nip5Address): number | null {
  if (!address.expires_at) return null;

  const parsed = Date.parse(address.expires_at);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whole days left, negative once it has lapsed. Null when it never expires. */
export function daysUntilExpiry(
  address: Nip5Address,
  now = Date.now()
): number | null {
  const expiry = expiresAt(address);
  if (expiry === null) return null;

  return Math.ceil((expiry - now) / 86_400_000);
}

export type Nip5State = 'inactive' | 'expired' | 'expiring' | 'active';

/** How long before expiry we start saying so. */
export const RENEWAL_WINDOW_DAYS = 30;

/**
 * The state worth telling someone about.
 *
 * `active: false` comes first because the extension uses it for a name whose
 * invoice has not settled — that one is not expired, it was never live, and
 * saying "expired" would send the person looking for a renew button that isn't
 * the fix.
 */
export function nip5State(address: Nip5Address, now = Date.now()): Nip5State {
  if (!address.active) return 'inactive';

  const days = daysUntilExpiry(address, now);
  if (days === null) return 'active';
  if (days <= 0) return 'expired';
  if (days <= RENEWAL_WINDOW_DAYS) return 'expiring';
  return 'active';
}

/**
 * The price of a name, in the words the server used.
 *
 * The extension prices in a currency of the domain's choosing and converts to
 * sats at quote time, so both numbers are shown when they differ — the fiat
 * figure is what was agreed, the sats figure is what the invoice will ask for
 * and it moves.
 */
export function describePrice(
  status: Pick<Nip5AddressStatus, 'price' | 'price_in_sats' | 'currency'>,
  years = 1
): string {
  const per = years > 1 ? `${years} years` : 'year';

  if (!status.price && !status.price_in_sats) return 'Free';

  const currency = (status.currency || '').trim();
  const sats = status.price_in_sats;

  if (!currency || /^(sat|sats|satoshis?)$/i.test(currency)) {
    return `${(sats ?? status.price ?? 0).toLocaleString()} sats / ${per}`;
  }

  const fiat = `${(status.price ?? 0).toFixed(2)} ${currency.toUpperCase()}`;
  return sats
    ? `${fiat} / ${per} (≈ ${sats.toLocaleString()} sats)`
    : `${fiat} / ${per}`;
}

/** The year counts to offer, given what the domain allows. */
export function yearOptions(maxYears = DEFAULT_MAX_YEARS): number[] {
  const cap = Math.max(1, Math.min(Math.floor(maxYears) || 1, 5));
  return Array.from({ length: cap }, (_, index) => index + 1);
}

/**
 * The payment hash to watch, whichever shape the claim response took.
 *
 * The extension returns the address and the invoice together, but which key
 * carries the hash depends on whether an invoice was actually needed — a free
 * name settles immediately and carries none.
 */
export function readPaymentHash(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const record = body as Record<string, unknown>;

  for (const key of ['payment_hash', 'checking_id']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }

  const nested = record.extra;
  if (nested && typeof nested === 'object') {
    const hash = (nested as Record<string, unknown>).payment_hash;
    if (typeof hash === 'string' && hash) return hash;
  }

  return undefined;
}

/** The address out of a claim response, which may or may not wrap it. */
export function readClaimedAddress(body: unknown): Nip5Address | null {
  if (!body || typeof body !== 'object') return null;

  const record = body as Record<string, unknown>;

  const nested = record.address;
  if (nested && typeof nested === 'object') {
    return nested as Nip5Address;
  }

  return typeof record.local_part === 'string'
    ? (body as Nip5Address)
    : null;
}
