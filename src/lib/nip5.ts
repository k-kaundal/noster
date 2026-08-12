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

/** One domain names can be bought under: the extension's id, and the hostname. */
export interface Nip5Domain {
  /** The extension's own id, which every request is addressed to. */
  id: string;
  /** What the name reads as, and where clients look for the well-known file. */
  domain: string;
}

/**
 * Reads the configured domains.
 *
 * Both halves have to be configured because neither can be discovered: the
 * extension lists domains behind a wallet key that answers for the operator's
 * account rather than the visitor's, and its search endpoint — the one public
 * route — returns the local part alone, with no hostname anywhere in the reply.
 * So an id without a hostname is an id we cannot name on screen.
 *
 * Written as `id:hostname` pairs, and read either way round: the half with a
 * dot in it is the hostname, since a domain id has none and a hostname always
 * does. Ordering is kept, so the first entry stays the default.
 */
export function parseNip5Domains(value: string | undefined): Nip5Domain[] {
  const domains: Nip5Domain[] = [];

  for (const entry of (value || '').split(/[\s,]+/)) {
    if (!entry) continue;

    const parts = entry.split(/[:=]/).filter(Boolean);
    if (parts.length < 2) continue;

    const domain = parts.find((part) => part.includes('.'));
    const id = parts.find((part) => part !== domain);
    if (!domain || !id) continue;

    // First one wins, so a repeat in the config cannot reorder the default
    if (domains.some((existing) => existing.id === id)) continue;

    domains.push({ id: id.trim(), domain: domain.trim().toLowerCase() });
  }

  return domains;
}

/**
 * Every domain this deployment sells names under, best first.
 *
 * `VITE_NIP5_DOMAIN_ID` and `VITE_NIP5_DOMAIN` still name the first, so an
 * existing deployment needs no change; `VITE_NIP5_DOMAINS` adds the rest. Left
 * empty, the whole feature stays hidden rather than offering a name it cannot
 * deliver.
 */
export const NIP5_DOMAINS: Nip5Domain[] = (() => {
  const primaryId = (import.meta.env.VITE_NIP5_DOMAIN_ID || '').trim();
  const primary: Nip5Domain[] = primaryId
    ? [
        {
          id: primaryId,
          domain:
            (import.meta.env.VITE_NIP5_DOMAIN || '').trim().toLowerCase() ||
            ADDRESS_DOMAIN,
        },
      ]
    : [];

  const rest = parseNip5Domains(import.meta.env.VITE_NIP5_DOMAINS).filter(
    (entry) => entry.id !== primaryId
  );

  return [...primary, ...rest];
})();

/**
 * The default domain, as an id and as a hostname.
 *
 * Kept as two plain exports because most of the app only ever needs to say
 * "our domain" — a placeholder, a line of copy. Anything holding a real
 * address should read that address's own domain instead, since a name bought
 * under the second domain is a different name.
 */
export const NIP5_DOMAIN_ID = NIP5_DOMAINS[0]?.id ?? '';
export const NIP5_DOMAIN = NIP5_DOMAINS[0]?.domain ?? ADDRESS_DOMAIN;

/** Whether the operator has set up the extension for this deployment. */
export function isNip5Configured(): boolean {
  return NIP5_DOMAINS.length > 0;
}

/** The configured domain with this id, when it is one of ours. */
export function nip5DomainById(id: string | undefined): Nip5Domain | undefined {
  return NIP5_DOMAINS.find((entry) => entry.id === id);
}

/**
 * The hostname a domain id reads as.
 *
 * Falls back to the default rather than to the id itself: a UUID rendered
 * where a hostname belongs looks like corrupted data, while the default is at
 * worst the wrong one of our own names — and an address on an unconfigured
 * domain is filtered out long before it reaches here.
 */
export function nip5Host(domainId: string | undefined): string {
  return nip5DomainById(domainId)?.domain ?? NIP5_DOMAIN;
}

/** Whether a domain id is one this deployment sells under. */
export function isOurNip5Domain(id: string | undefined): boolean {
  return !!nip5DomainById(id);
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
  /** The code that was applied, when one was. */
  promo_code?: string;
  /** Who gets the referrer half of a promotion, when the code names one. */
  referer?: string;
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

/**
 * What a name someone holds actually reads as.
 *
 * Uses the address's own domain rather than the default one. With a single
 * domain configured the two are always the same, which is exactly why this is
 * worth having: the moment a second one exists, every place that formatted a
 * name against the default started publishing the wrong hostname into people's
 * profiles, and a `nip05` pointing at the wrong domain fails verification
 * silently — the ✓ simply never appears.
 */
export function nip5Identifier(
  address: Pick<Nip5Address, 'local_part' | 'domain_id'> | null | undefined
): string | null {
  if (!address?.local_part) return null;
  return formatNip5(address.local_part, nip5Host(address.domain_id));
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

/** The floor and ceiling a new attachment gets, matching the extension's own. */
export const DEFAULT_LN_MIN_SATS = 1;
export const DEFAULT_LN_MAX_SATS = 10_000_000;

/**
 * The body for attaching a lightning address to a NIP-05 name.
 *
 * `PUT .../address/{id}/lnaddress` creates or updates in one call, so the same
 * body both switches a name on and moves it to a different wallet later.
 *
 * `wallet` is the whole point and the thing worth being deliberate about: it
 * decides where the money lands. An account can hold several wallets, and
 * defaulting to whichever one happens to be selected sends zaps somewhere the
 * person did not choose and will not think to look.
 */
export function buildLnAddressBody(input: {
  walletId: string;
  minSats?: number;
  maxSats?: number;
}): Nip5LnAddressConfig {
  return {
    wallet: input.walletId,
    /*
     * Both clamped to something payable. A zero minimum is rejected by the
     * extension, and a maximum below the minimum produces an address that
     * refuses every payment — which resolves and looks fine from the outside.
     */
    min: Math.max(1, Math.round(input.minSats ?? DEFAULT_LN_MIN_SATS)),
    max: Math.max(
      Math.max(1, Math.round(input.minSats ?? DEFAULT_LN_MIN_SATS)),
      Math.round(input.maxSats ?? DEFAULT_LN_MAX_SATS)
    ),
  };
}

/**
 * The lightning address attached to a name, when one is.
 *
 * Keyed off `wallet` rather than off the object existing, because the
 * extension stores a `ln_address` shape with an empty wallet on every address
 * whether or not one was ever set up — so the object's presence says nothing.
 */
export function lnAddressConfig(
  address: Pick<Nip5Address, 'extra'> | null | undefined
): Nip5LnAddressConfig | null {
  const config = address?.extra?.ln_address;
  return config?.wallet ? config : null;
}

/** Whether a name receives payments as well as verifying a key. */
export function isZappable(
  address: Pick<Nip5Address, 'extra'> | null | undefined
): boolean {
  return !!lnAddressConfig(address);
}

/**
 * Cleans up a promo code the way somebody will actually type one.
 *
 * These get read off a poster, a podcast, a friend's message — with a trailing
 * space, in the wrong case, occasionally wrapped in quotes. All of those name
 * a real code and all of them fail an exact comparison on the server, which
 * answers "no such promotion" and looks like the code was fake.
 */
export function normalizePromoCode(input: string): string {
  return input.trim().replace(/^["']|["']$/g, '').toUpperCase();
}

/** What a promo code turned out to be worth. */
export interface PromoOutcome {
  /** Whether the server charged less than it quoted. */
  applied: boolean;
  /** Sats saved, when both figures are in sats and the code worked. */
  savedSats?: number;
}

/**
 * Compares the price that was quoted against the price that was charged.
 *
 * Asked *after* the claim rather than before it, because there is nowhere to
 * ask before: the search endpoint takes a name and a year count and knows
 * nothing about codes, so the only place a discount becomes visible is the
 * invoice raised in response to the claim. Somebody who typed a code that does
 * not exist would otherwise pay full price with no sign of it — the server
 * ignores an unknown code rather than refusing the claim.
 */
export function promoOutcome(
  quoted: Pick<Nip5AddressStatus, 'price' | 'price_in_sats'> | null | undefined,
  charged: Nip5AddressExtra | null | undefined
): PromoOutcome {
  if (!quoted || !charged) return { applied: false };

  const before = quoted.price_in_sats;
  const after = charged.price_in_sats;

  if (
    typeof before === 'number' &&
    typeof after === 'number' &&
    after < before
  ) {
    return { applied: true, savedSats: Math.round(before - after) };
  }

  /**
   * Falls back to the currency figure when sats are missing on either side.
   * Reported as applied without an amount rather than as not applied, since
   * "your code did nothing" is the one wrong answer here.
   */
  if (
    typeof quoted.price === 'number' &&
    typeof charged.price === 'number' &&
    charged.price < quoted.price
  ) {
    return { applied: true };
  }

  return { applied: false };
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
