/**
 * Lightning addresses (LUD-16) issued to our users by the LNbits `lnurlp`
 * extension.
 *
 * Not derived from the LNbits host: serving these under a nicer domain only
 * needs that domain to proxy `/.well-known/lnurlp/*` through to LNbits, which
 * answers the well-known route on its own origin only. See
 * docs/lightning-addresses.md.
 *
 * There can be several. One LNbits instance can answer for any number of
 * domains, and the domain is part of the address — `alice@one.example` and
 * `alice@two.example` are two different addresses that can pay two different
 * wallets. So a domain is carried alongside a name everywhere rather than
 * appended at the end, because the moment it is assumed, every address under
 * the other domains renders as somebody else's.
 */

import { LNBITS_URL } from '@/lib/lnbits';

/** Trims off the things people paste around a domain but never mean. */
export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

/**
 * The LNbits host, which always answers for the addresses it issues.
 *
 * This is the one domain that needs no configuration and no proxy rule:
 * LNbits serves `/.well-known/lnurlp/*` on its own origin, so an address at
 * this host works the moment a pay link exists. Everything else is a nicer
 * name pointed at it.
 */
function lnbitsHost(): string {
  try {
    return new URL(LNBITS_URL).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Every domain this app issues addresses under, best first.
 *
 * Read from two settings so an existing deployment does not have to change:
 * `VITE_LIGHTNING_ADDRESS_DOMAIN` still names the primary, and
 * `VITE_LIGHTNING_ADDRESS_DOMAINS` adds the rest. Order matters — the first is
 * what a new address gets unless somebody picks otherwise — so the singular
 * setting is read first and duplicates are dropped rather than reordered.
 *
 * Configured neither way, this falls back to the LNbits host rather than to a
 * hostname written down here. A literal default is a second place the truth
 * lives: remove the setting from a deployment pointed somewhere else and every
 * address in the app is suddenly named at a domain that has never heard of it,
 * while the host actually serving them is sitting right there in `LNBITS_URL`.
 */
export const ADDRESS_DOMAINS: string[] = (() => {
  const configured = [
    import.meta.env.VITE_LIGHTNING_ADDRESS_DOMAIN,
    import.meta.env.VITE_LIGHTNING_ADDRESS_DOMAINS,
  ]
    .filter((value): value is string => typeof value === 'string' && !!value)
    .join(',')
    .split(/[\s,]+/)
    .map(normalizeDomain)
    .filter(Boolean);

  const unique = [...new Set(configured)];
  if (unique.length) return unique;

  const host = lnbitsHost();
  return host ? [host] : ['ln.nostrfeed.com'];
})();

/**
 * The one a new address gets by default.
 *
 * Kept as a single export because most of the app only ever needs to say "our
 * domain" — an empty-state placeholder, a line of marketing copy. Anything
 * handling a real address should use the address's own domain instead.
 */
export const ADDRESS_DOMAIN = ADDRESS_DOMAINS[0];

/**
 * The domains a free, assigned address may be issued under.
 *
 * Serving a domain and giving names away under it are separate decisions. A
 * deployment can answer for a second, premium domain that is only ever sold —
 * and reading the free domain off the top of `ADDRESS_DOMAINS` hands that
 * inventory to anyone who presses the free button, which is exactly what
 * happened here: with `getzap.me,ln.nostrfeed.com` configured, every free
 * address was issued at the paid name.
 *
 * `VITE_FREE_LIGHTNING_ADDRESS_DOMAIN(S)` names them. Unconfigured, this falls
 * back to the LNbits host when we serve it, because that is the one domain
 * that costs nothing to answer for: LNbits serves `/.well-known/lnurlp/*` on
 * its own origin, so an address there works without a proxy rule and without
 * anybody having bought anything. Every other domain we list is a nicer name
 * pointed at it, which is the thing worth selling.
 *
 * Filtered to domains we actually serve — a free domain we do not answer for
 * issues addresses nobody can pay.
 */
export const FREE_ADDRESS_DOMAINS: string[] = (() => {
  const configured = [
    import.meta.env.VITE_FREE_LIGHTNING_ADDRESS_DOMAIN,
    import.meta.env.VITE_FREE_LIGHTNING_ADDRESS_DOMAINS,
  ]
    .filter((value): value is string => typeof value === 'string' && !!value)
    .join(',')
    .split(/[\s,]+/)
    .map(normalizeDomain)
    .filter((entry) => ADDRESS_DOMAINS.includes(entry));

  const unique = [...new Set(configured)];
  if (unique.length) return unique;

  const host = lnbitsHost();
  return ADDRESS_DOMAINS.includes(host) ? [host] : [ADDRESS_DOMAINS[0]];
})();

/** Where an assigned address lands unless somebody picks another free one. */
export const FREE_ADDRESS_DOMAIN = FREE_ADDRESS_DOMAINS[0];

/**
 * What a pay link with no domain of its own answers to.
 *
 * LNbits stores a domain per link, and a link made before the instance served
 * more than one has none. That link is reachable at the LNbits host, which
 * answers the well-known route on its own origin — so that is the honest name
 * to print for it. Taking the first configured domain instead labels it at
 * whichever name happens to be listed first, and on a deployment that serves
 * two, that is a domain which has never heard of the link: the address reads
 * fine and resolves nowhere.
 *
 * Falls back to the default domain when the LNbits host is not one we issue
 * under, which is the single-domain deployment behind a proxy — there the
 * configured name is the only one anybody was ever given.
 */
export const DEFAULT_LINK_DOMAIN: string = (() => {
  const host = lnbitsHost();
  return ADDRESS_DOMAINS.includes(host) ? host : ADDRESS_DOMAIN;
})();

/** Whether a domain gives names away, rather than selling every one of them. */
export function isFreeAddressDomain(domain: string): boolean {
  return FREE_ADDRESS_DOMAINS.includes(normalizeDomain(domain));
}

/** Whether a domain is one of ours. */
export function isOurDomain(domain: string): boolean {
  return ADDRESS_DOMAINS.includes(normalizeDomain(domain));
}

/** Longest local part we will issue. Kept short enough to stay memorable. */
export const MAX_USERNAME_LENGTH = 32;
export const MIN_USERNAME_LENGTH = 2;

/**
 * Latin letters Unicode normalisation will not take apart.
 *
 * NFKD decomposes an accented letter into a base plus a combining mark, but
 * these are distinct letters rather than decorated ones, so it leaves them
 * whole and the ASCII filter then deletes them outright — turning "Ærik" into
 * "rik". Spelling them out keeps the name recognisable.
 */
const LIGATURES: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  þ: 'th',
  ħ: 'h',
  ŋ: 'n',
};

/**
 * Reduces any display name to something usable as an address local part.
 *
 * LUD-16 restricts the local part to `a-z0-9-_.`, so a Nostr display name —
 * which can be anything, including emoji and spaces — has to be folded down
 * rather than used directly. Accents are decomposed so "José" becomes "jose"
 * instead of "jos".
 */
export function suggestUsername(input: string): string {
  return input
    .toLowerCase()
    .replace(/[æœßøđðłþħŋ]/g, (letter) => LIGATURES[letter] ?? letter)
    .normalize('NFKD')
    // Strip combining marks left behind by the decomposition
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-_.]+/g, '')
    // Leading and trailing punctuation reads as a typo in an address
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, MAX_USERNAME_LENGTH);
}

export type UsernameProblem =
  | 'too-short'
  | 'too-long'
  | 'invalid-characters'
  | 'edge-punctuation'
  | null;

/** Why a username can't be used, or null when it can. */
export function validateUsername(username: string): UsernameProblem {
  if (username.length < MIN_USERNAME_LENGTH) return 'too-short';
  if (username.length > MAX_USERNAME_LENGTH) return 'too-long';
  if (!/^[a-z0-9-_.]+$/.test(username)) return 'invalid-characters';
  if (/^[-_.]|[-_.]$/.test(username)) return 'edge-punctuation';
  return null;
}

export function describeUsernameProblem(problem: UsernameProblem): string {
  switch (problem) {
    case 'too-short':
      return `At least ${MIN_USERNAME_LENGTH} characters.`;
    case 'too-long':
      return `At most ${MAX_USERNAME_LENGTH} characters.`;
    case 'invalid-characters':
      return 'Lowercase letters, numbers, dots, dashes and underscores only.';
    case 'edge-punctuation':
      return "Can't start or end with a dot, dash or underscore.";
    default:
      return '';
  }
}

/** The full address a username resolves to, under one of our domains. */
export function formatAddress(username: string, domain?: string): string {
  return `${username}@${domain ? normalizeDomain(domain) : DEFAULT_LINK_DOMAIN}`;
}

/** Where a wallet-app will actually fetch the LNURL-pay metadata from. */
export function wellKnownUrl(username: string, domain?: string): string {
  const host = domain ? normalizeDomain(domain) : DEFAULT_LINK_DOMAIN;
  return `https://${host}/.well-known/lnurlp/${username}`;
}

/**
 * The address a pay link answers to.
 *
 * The link's own domain wins, and the configured default only stands in when
 * it has none — which is what an instance serving a single domain returns, and
 * what every link created before multi-domain support looks like.
 */
export function linkAddress(link: {
  username?: string;
  domain?: string | null;
}): string | null {
  if (!link.username) return null;
  return formatAddress(link.username, link.domain || undefined);
}

/**
 * The body for creating the pay link behind an address.
 *
 * Two of these defaults are load-bearing and easy to get wrong:
 *
 * - `disposable` defaults to **true** in the LNbits API, which produces a
 *   single-use link. An address that stops working after one payment is not an
 *   address, so this is always false.
 * - `comment_chars` defaults to 0, and a zap carries its message as an LNURL
 *   comment. Leaving it at zero produces an address that technically receives
 *   zaps but silently discards what people wrote.
 */
export function buildPayLinkBody(input: {
  username: string;
  walletId: string;
  /**
   * Which of our domains it answers under. Omitted rather than defaulted, so
   * an instance serving one domain gets exactly the body it got before.
   */
  domain?: string;
  displayName?: string;
  minSats?: number;
  maxSats?: number;
}) {
  return {
    description: input.displayName
      ? `Zap ${input.displayName} on NostrFeed`
      : 'NostrFeed',
    wallet: input.walletId,
    username: input.username,
    ...(input.domain ? { domain: normalizeDomain(input.domain) } : {}),
    min: input.minSats ?? 1,
    max: input.maxSats ?? 10_000_000,
    // NIP-57: makes LNbits advertise allowsNostr and publish zap receipts
    zaps: true,
    comment_chars: 255,
    disposable: false,
  };
}

/** The shape of a pay link, as much of it as repairing one needs. */
export interface PayLinkFields {
  id: string;
  wallet: string;
  description?: string;
  username?: string;
  domain?: string | null;
  zaps?: boolean;
  disposable?: boolean;
  min?: number;
  max?: number;
  comment_chars?: number;
}

/**
 * Whether an address is one that zaps will never appear from.
 *
 * `zaps` is what makes LNbits advertise `allowsNostr` and publish a kind 9735
 * after a payment. Without it the money still arrives — so nothing looks
 * broken to the person being paid — but no receipt is ever written, and a
 * receipt is the only evidence a zap happened. Every count on Nostr is built
 * from receipts, so an address in this state reads as zero zaps forever, on
 * every post, in every client, including the totals a fundraising goal adds up.
 *
 * New addresses have been created with it on. Ones made before that, or made
 * anywhere else, have not — and this flag has been sitting in the API response
 * unread the whole time.
 */
export function payLinkPublishesZaps(link: PayLinkFields): boolean {
  return link.zaps === true;
}

/**
 * The body that turns zaps on for an existing pay link.
 *
 * Every field is sent back, not just the one being changed: LNbits' `PUT`
 * replaces the link rather than patching it, so anything omitted reverts to an
 * API default — and two of those defaults break an address outright.
 * `disposable` defaults to true, which makes it single-use, and
 * `comment_chars` to 0, which silently discards the message on every zap.
 */
export function buildZapsUpdateBody(link: PayLinkFields) {
  return {
    description: link.description || 'NostrFeed',
    wallet: link.wallet,
    ...(link.username ? { username: link.username } : {}),
    ...(link.domain ? { domain: link.domain } : {}),
    min: link.min ?? 1,
    max: link.max ?? 10_000_000,
    zaps: true,
    comment_chars: link.comment_chars ?? 255,
    disposable: link.disposable ?? false,
  };
}

/** A lightning address someone holds somewhere other than here. */
export interface ExternalAddress {
  /** The part before the `@`. */
  name: string;
  /** The part after it, lowercased. */
  domain: string;
  /** The whole thing, normalised. */
  address: string;
  /** Where a wallet fetches its LNURL-pay offer from. */
  lnurlpUrl: string;
}

export type AddressProblem =
  | 'empty'
  | 'not-an-address'
  | 'invalid-name'
  | 'invalid-domain'
  | null;

/**
 * Reads an address someone bought or was given elsewhere.
 *
 * People paste these from all sorts of places, so what arrives is rarely the
 * bare string: `lightning:` prefixes from QR codes, a leading ⚡ from profile
 * pages, capitals from a phone keyboard that helpfully capitalised the first
 * letter. All of those name a working address and all of them fail a strict
 * comparison, so they are normalised rather than rejected.
 *
 * An LNURL string is refused rather than unpacked. `lnurl1...` is a different
 * encoding of a payment endpoint and is not what `lud16` holds — a profile
 * carrying one there is unzappable by every client that reads the field.
 */
export function parseLightningAddress(
  input: string
): { address: ExternalAddress; problem: null } | { address: null; problem: AddressProblem } {
  const value = input
    .trim()
    .replace(/^(lightning:|⚡\s*)/i, '')
    .trim()
    .toLowerCase();

  if (!value) return { address: null, problem: 'empty' };
  if (!value.includes('@')) return { address: null, problem: 'not-an-address' };

  const [name, ...rest] = value.split('@');
  const domain = rest.join('@');

  if (!name || !/^[a-z0-9-_.]+$/.test(name)) {
    return { address: null, problem: 'invalid-name' };
  }

  // A hostname with at least one dot and no path, port or credentials on it
  if (!domain || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    return { address: null, problem: 'invalid-domain' };
  }

  return {
    problem: null,
    address: {
      name,
      domain,
      address: `${name}@${domain}`,
      lnurlpUrl: `https://${domain}/.well-known/lnurlp/${name}`,
    },
  };
}

export function describeAddressProblem(problem: AddressProblem): string {
  switch (problem) {
    case 'empty':
      return 'Enter an address.';
    case 'not-an-address':
      return 'A lightning address looks like you@example.com.';
    case 'invalid-name':
      return 'The part before the @ can only be letters, numbers, dots, dashes and underscores.';
    case 'invalid-domain':
      return "That doesn't look like a domain name.";
    default:
      return '';
  }
}

/** The domain half of an address, or empty when it has none. */
export function addressDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at > 0 ? normalizeDomain(address.slice(at + 1)) : '';
}

/** Whether an address is one this app issues, under any of its domains. */
export function isOurAddress(address: string): boolean {
  const domain = addressDomain(address.trim());
  return !!domain && isOurDomain(domain);
}
