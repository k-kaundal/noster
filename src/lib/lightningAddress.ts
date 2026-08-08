/**
 * Lightning addresses (LUD-16) issued to our users by the LNbits `lnurlp`
 * extension.
 *
 * The domain is configurable because the address domain and the LNbits host do
 * not have to be the same. `alice@ln.nostrfeed.com` works with no extra
 * infrastructure, since LNbits serves its own well-known route. `alice@
 * nostrfeed.com` is nicer but needs the apex domain to proxy
 * `/.well-known/lnurlp/*` to LNbits — see docs/lightning-addresses.md.
 */
export const ADDRESS_DOMAIN =
  import.meta.env.VITE_LIGHTNING_ADDRESS_DOMAIN ||
  (import.meta.env.VITE_LNBITS_URL || 'https://ln.nostrfeed.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

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

/** The full address a username resolves to. */
export function formatAddress(username: string): string {
  return `${username}@${ADDRESS_DOMAIN}`;
}

/** Where a wallet-app will actually fetch the LNURL-pay metadata from. */
export function wellKnownUrl(username: string): string {
  return `https://${ADDRESS_DOMAIN}/.well-known/lnurlp/${username}`;
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
    min: input.minSats ?? 1,
    max: input.maxSats ?? 10_000_000,
    // NIP-57: makes LNbits advertise allowsNostr and publish zap receipts
    zaps: true,
    comment_chars: 255,
    disposable: false,
  };
}
