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
import { paymentTimeMs } from '@/lib/lnbits';

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

/**
 * The server's verdict on a code, as `PromoCodeStatus` in the schema.
 *
 * The extension computes this from its own promotion list and hangs it off the
 * address — it is stored nowhere, so it is recomputed on every read and always
 * reflects the promotion as it stands now.
 *
 * `buyer_discount` is a **percent**, and zero is the answer for a code the
 * server has never heard of: `get_promotion` returns nothing and the percent
 * falls to 0. That is the whole reason this field is worth reading. Everything
 * else about a bad code looks exactly like a good one — the claim succeeds, an
 * invoice is raised, no error is reported anywhere.
 */
export interface Nip5PromoCodeStatus {
  /** Percent off, 0–100. Zero means no promotion matched the code. */
  buyer_discount?: number | null;
  /** Whether the code lets the buyer name who gets the referrer's cut. */
  allow_referer?: boolean;
  referer?: string | null;
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
  /**
   * What the server makes of the code on this address.
   *
   * Present on a claim response and on every entry from `/user/addresses`, so
   * a reservation left unpaid still carries the verdict on the code it was
   * made with — days later, in another browser.
   */
  promo_code_status?: Nip5PromoCodeStatus;
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

/**
 * Whether a name actually receives payments.
 *
 * `wallet` is the request; `pay_link_id` is the pay link LNbits created to
 * honour it, and only that second field means money can arrive. The extension
 * stores the two independently — its own schema defaults `pay_link_id` to the
 * empty string — so a name whose attachment was asked for and never completed
 * carries a wallet and nothing behind it.
 *
 * Reading `wallet` alone is how the wallet page came to announce that a name
 * "receives payments" when no pay link had ever been made for it: the claim
 * was about a stored preference rather than about anything payable, and
 * nothing on the screen could tell the two apart.
 */
export function isZappable(
  address: Pick<Nip5Address, 'extra'> | null | undefined
): boolean {
  return !!lnAddressConfig(address)?.pay_link_id;
}

/**
 * Asked for, but with no pay link behind it yet.
 *
 * The state worth naming rather than folding into either side. It is not "no
 * address" — somebody chose a wallet — and it is not a working one, so a
 * person told either of those things is told something false. It resolves on
 * its own once the extension finishes, and stays put when it failed.
 */
export function isLnAddressPending(
  address: Pick<Nip5Address, 'extra'> | null | undefined
): boolean {
  const config = lnAddressConfig(address);
  return !!config && !config.pay_link_id;
}

/**
 * Cleans up a promo code the way somebody will actually type one.
 *
 * These get read off a poster, a podcast, a friend's message, and arrive with
 * a trailing space or wrapped in quotes — neither of which the person meant to
 * type, and both of which fail the server's comparison.
 *
 * The case is left exactly as typed, which is a correction: this used to
 * uppercase, and the extension compares `promotion.code == promo_code` with no
 * folding at all. So a code the operator entered as `spring24` could not be
 * redeemed by anybody, however carefully they typed it — the client rewrote it
 * to `SPRING24` on the way out and the server found no such promotion. Forcing
 * a case invents one the person did not choose; leaving it alone at worst
 * fails a code they typed wrongly, which they can see and fix.
 *
 * A code may also carry a referrer as `CODE@name`, which the server splits off
 * itself. Case matters there too — it names somebody's identifier.
 */
export function normalizePromoCode(input: string): string {
  return input.trim().replace(/^["']|["']$/g, '');
}

/**
 * What became of a code somebody typed.
 *
 * `ignored` is the state worth having a name for. The server does not refuse a
 * code it has never heard of — it drops it and raises a full-price invoice —
 * so an expired code, a typo and a code that was never real all end the same
 * way, and none of them announce themselves. Left unsaid, somebody pays full
 * price believing they got a discount.
 *
 * `unknown` is honest ignorance: a code was typed and there is nothing to
 * compare it against, because the search never answered or one side quoted no
 * figure. Distinct from `ignored`, which is a claim about what happened.
 */
export type PromoResult = 'none' | 'applied' | 'ignored' | 'unknown';

/** What a name costs, said as the sum a person can check. */
export interface PriceBreakdown {
  promo: PromoResult;
  /** The code, as the server recorded it or as it was typed. */
  code?: string;
  /**
   * Whether the server itself answered for the code, rather than the answer
   * being read off the price.
   *
   * The difference is worth carrying: checked, "there is no such code" is a
   * fact the server stated; unchecked, it is the best reading of two numbers,
   * and a promotion worth nothing to this buyer looks identical to a typo.
   */
  checked: boolean;
  /** The unit both figures are in: `sats`, or the domain's currency. */
  unit: string;
  /** The list price, before any code. Absent when the search never answered. */
  list?: number;
  /** What the invoice actually asks for. */
  paid?: number;
  /** The difference, when the price went down. */
  saved?: number;
  /** Whole percent off, which is the form a promotion is usually quoted in. */
  savedPercent?: number;
}

/** One figure out of the pair, preferring the one that exists. */
function figure(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The sum behind an invoice: what it listed at, what the code took off, what
 * is owed.
 *
 * Worked out *after* the claim rather than before it, because there is nowhere
 * to ask before. The extension's search endpoint takes a name and a year count
 * and nothing else, and the promotions themselves live on the domain record,
 * which is readable only with the operator's API key — a key that cannot go in
 * a browser bundle. So the reservation is the first moment a code's worth
 * exists, and this is how that moment gets shown as a sum rather than as one
 * number with no story.
 *
 * `status` is the server answering for the code directly, and it outranks
 * everything else here. The extension hands back a `buyer_discount` percent
 * with the reservation and with every later read of the address — zero for a
 * code it has no promotion for. Reading it turns the one question that used to
 * be a guess ("did that code do anything?") into something checked, and it
 * answers even when nothing was quoted to compare against.
 *
 * The typed code matters too, because the server's silence is only legible
 * against somebody's intent: with no code typed there is nothing to report,
 * and with one typed a price that did not move is news.
 */
export function priceBreakdown(
  quoted: Pick<Nip5AddressStatus, 'price' | 'price_in_sats' | 'currency'> | null | undefined,
  charged: Nip5AddressExtra | null | undefined,
  typedCode?: string,
  status?: Nip5PromoCodeStatus | null
): PriceBreakdown {
  /*
   * Sats when either side carries them, which is nearly always: the extension
   * prices in the domain's currency and converts at quote time, and an invoice
   * is denominated in sats by definition. Mixing the two units in one column
   * would produce a subtraction that does not hold.
   */
  const inSats =
    figure(quoted?.price_in_sats) !== undefined ||
    figure(charged?.price_in_sats) !== undefined;

  const unit = inSats
    ? 'sats'
    : (charged?.currency || quoted?.currency || 'sats').trim() || 'sats';

  const paid = inSats ? figure(charged?.price_in_sats) : figure(charged?.price);
  const code = normalizePromoCode(typedCode ?? '') || charged?.promo_code;

  /** The percent the server says this code is worth. Zero means no such code. */
  const stated = code ? figure(status?.buyer_discount) : undefined;

  /**
   * What it lists at.
   *
   * The search quote when there is one — but a reservation reopened later has
   * no quote beside it, and the extension stores only the price *after* the
   * discount, so the list price is gone from the record entirely. The stated
   * percent puts it back: it is the one number from which the other two follow.
   */
  const quotedList = inSats ? figure(quoted?.price_in_sats) : figure(quoted?.price);
  const list =
    quotedList ??
    (paid !== undefined && stated !== undefined && stated > 0 && stated < 100
      ? paid / (1 - stated / 100)
      : undefined);

  const saved =
    list !== undefined && paid !== undefined && paid < list
      ? list - paid
      : undefined;

  const promo = ((): PromoResult => {
    if (!code) return 'none';

    /*
     * The server's own answer, which is not a reading of anything. A promotion
     * it cannot find scores zero, and that is the case worth being certain
     * about — the claim still succeeds and the invoice is still raised, so
     * every other sign of a dead code is indistinguishable from a live one.
     */
    if (stated !== undefined) return stated > 0 ? 'applied' : 'ignored';

    if (saved !== undefined) return 'applied';

    /*
     * Only a price with something to discount can be said to have ignored a
     * code. A free name is already zero, and telling somebody their code
     * "didn't work" on a name that costs nothing is a complaint about nothing.
     */
    if (paid === 0 && !list) return 'none';
    if (list !== undefined && paid !== undefined && list > 0) return 'ignored';

    return 'unknown';
  })();

  return {
    promo,
    code: code || undefined,
    checked: stated !== undefined,
    unit,
    list,
    paid,
    saved,
    /*
     * The stated percent wins over the computed one. Both describe the same
     * discount, but the server's is the figure the promotion was written with,
     * while ours is a ratio of two rounded amounts — so a 15% code can come
     * back out as 14% purely from the sats conversion.
     */
    savedPercent:
      stated !== undefined && stated > 0
        ? Math.round(stated)
        : saved !== undefined && list
          ? Math.round((saved / list) * 100)
          : undefined,
  };
}

/**
 * Why a reservation with a code in it failed, when the reason is the code.
 *
 * A code worth 100% takes the price to zero, and the extension asserts on a
 * falsy price before it ever gets to raising an invoice — so a full-value code
 * is refused by the arithmetic rather than honoured, and the only thing said
 * about it is `Cannot compute price for 'name'`, which reads like the name is
 * the problem. Nothing in the flow suggests removing the code, which is the
 * one thing that makes the reservation go through.
 */
export function promoClaimHint(
  message: string,
  code?: string
): string | null {
  if (!code || !/cannot compute price/i.test(message)) return null;

  return `${code} appears to take the price to nothing, and a name cannot be reserved for an invoice of zero. Reserve it without the code, or use one worth less than the full price.`;
}

/** An amount in whichever unit the breakdown is denominated in. */
export function formatAmount(amount: number, unit: string): string {
  if (/^(sat|sats|satoshis?)$/i.test(unit)) {
    return `${Math.round(amount).toLocaleString()} sats`;
  }

  return `${amount.toFixed(2)} ${unit.toUpperCase()}`;
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

/** Where the invoices we raised are kept, since the server keeps none. */
const INVOICE_STORE = 'nip5-pending-invoices';

/** Absent while prerendering, and refused outright in some private modes. */
function invoiceStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readInvoices(storage: Storage | null): Record<string, string> {
  if (!storage) return {};
  try {
    const raw = JSON.parse(storage.getItem(INVOICE_STORE) ?? '{}');
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Keeps the invoice raised for a name, because nothing else does.
 *
 * `extra.payment_hash` looks like the durable record of a purchase and is not
 * one: `activate_address` is the only thing that ever writes it, so it is
 * populated exactly when it has stopped being needed and empty for the whole
 * window it was being read in. A reservation left unpaid therefore had no hash
 * anywhere except the claim response, which lived in component state — so a
 * reload lost the ability to tell "not paid" from "paid, not switched on", and
 * the screen asked for the money again either way.
 */
export function rememberNip5Invoice(
  addressId: string,
  paymentHash: string,
  storage: Storage | null = invoiceStore()
): void {
  if (!storage || !addressId || !paymentHash) return;
  try {
    storage.setItem(
      INVOICE_STORE,
      JSON.stringify({ ...readInvoices(storage), [addressId]: paymentHash })
    );
  } catch {
    // A full or refused store costs the recovery path, not the purchase
  }
}

/** Drops an invoice once its name is live and nothing is owed. */
export function forgetNip5Invoice(
  addressId: string,
  storage: Storage | null = invoiceStore()
): void {
  if (!storage || !addressId) return;
  try {
    const invoices = readInvoices(storage);
    delete invoices[addressId];
    storage.setItem(INVOICE_STORE, JSON.stringify(invoices));
  } catch {
    // Same
  }
}

/**
 * The invoice an unpaid name is still waiting on.
 *
 * Prefers the address's own record and falls back to ours. The server's is
 * authoritative when it exists — it is written at activation — and ours is the
 * one that exists during the wait, which is the only time this is asked.
 */
export function outstandingPaymentHash(
  address: Pick<Nip5Address, 'id' | 'active' | 'extra'> | null | undefined,
  storage: Storage | null = invoiceStore()
): string | undefined {
  if (!address || address.active) return undefined;
  return (
    address.extra?.payment_hash || readInvoices(storage)[address.id] || undefined
  );
}

/** An outgoing payment, as the wallet ledger records one. */
interface LedgerEntry {
  /** Millisatoshis, negative for money leaving. */
  amount: number;
  status?: string;
  memo?: string;
  time?: string | number;
}

/**
 * How long activation is allowed to take before a payment counts as stuck.
 *
 * The extension activates from its invoice listener, in the same breath as the
 * payment settling — there is no queue and nothing to wait for. A minute is
 * already far outside the honest range, and it keeps the "we have your money
 * and the name is not live" panel from flashing up in the seconds between
 * paying and the address list catching up.
 */
const ACTIVATION_GRACE_MS = 60_000;

/**
 * Money of theirs already spent on this name, if the ledger shows any.
 *
 * The other half of telling "not paid" from "paid and not switched on", and
 * the half that works backwards: the invoice belongs to the operator's wallet,
 * but paying it from the wallet in this app leaves a row in *their* ledger,
 * and the extension writes the identifier into the memo it raises the invoice
 * with — `Payment of 2100 sats for NIP-05 name@domain`.
 *
 * Only outgoing and only settled. A reimbursement for the same name is an
 * incoming payment with a memo just as similar, and reading one as proof of
 * purchase would say a refund was a payment.
 */
export function findNamePayment<T extends LedgerEntry>(
  identifier: string | null | undefined,
  payments: readonly T[] | null | undefined,
  /** Only payments settled longer ago than this. Zero takes the newest too. */
  settledForMs = ACTIVATION_GRACE_MS,
  now = Date.now()
): T | undefined {
  if (!identifier) return undefined;

  const needle = identifier.toLowerCase();

  return (payments ?? []).find((payment) => {
    if (payment.amount >= 0 || payment.status !== 'success') return false;

    const memo = payment.memo?.toLowerCase() ?? '';
    if (!memo.includes('nip-05') || !memo.includes(needle)) return false;

    /*
     * An unreadable timestamp answers 0, which is older than everything — the
     * right way round here, since a payment we cannot date is one that has had
     * every chance to be acted on.
     */
    return now - paymentTimeMs(payment.time) >= settledForMs;
  });
}

/**
 * Whether the wallet a name pays into is still one this account holds.
 *
 * The extension stores a wallet id on the address and never revisits it, so
 * the id outlives the account that owned it: a name attached while signed in
 * as one LNbits user keeps pointing at that user's wallet after signing in as
 * another — with a `?usr=` link, with a password, or from a second Nostr key.
 *
 * Sending that id back is what produces a bare 500 from
 * `PUT .../address/{id}/lnaddress`. The extension looks the wallet up against
 * the authenticated account, finds nothing, and raises rather than reporting —
 * so the failure arrives with no body and reads like the feature is broken,
 * when what is wrong is that the name is pointed somewhere the person signed
 * in can no longer reach.
 */
export function attachedWalletIsForeign(
  address: Pick<Nip5Address, 'extra'> | null | undefined,
  walletIds: string[]
): boolean {
  const wallet = lnAddressConfig(address)?.wallet;
  return !!wallet && !walletIds.includes(wallet);
}

/**
 * The wallet to offer for a name, given what the account actually has.
 *
 * Never the stored one when it belongs elsewhere — defaulting to it is how the
 * broken id got sent back on every retry, including from the "Finish setting
 * it up" button, which failed identically each time.
 */
export function defaultAttachWallet(
  address: Pick<Nip5Address, 'extra'> | null | undefined,
  walletIds: string[]
): string {
  const wallet = lnAddressConfig(address)?.wallet;
  if (wallet && walletIds.includes(wallet)) return wallet;
  return walletIds[0] ?? '';
}
