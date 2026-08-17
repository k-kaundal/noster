import { defineKey, readStore, writeStore } from '@/lib/store';

/**
 * Which key each lightning server signs its zap receipts with.
 *
 * NIP-57 Appendix F: "the zap receipt event's pubkey MUST be the same as the
 * recipient's lnurl provider's nostrPubkey". It is the only check in the whole
 * validation that prevents forgery — every other one confirms a receipt is
 * internally consistent, which a forger controls entirely. Without it anybody
 * can publish a kind 9735 naming any note and any amount, and it counts.
 *
 * The check has always existed in `validateZapReceipt`. What was missing was
 * anyone supplying the key, and the reason is a real one: learning it means an
 * LNURL request to the author's lightning server, and doing that per note on a
 * feed is both a request per visible post and a running disclosure to third
 * parties of what the reader is looking at.
 *
 * So it is never fetched to validate. It is *remembered* from the requests the
 * app already makes — every zap sent, every payment offer resolved.
 *
 * The consequence is a cache that fills where the app is used. An address
 * nobody here has ever paid stays unknown, and receipts for it are treated
 * exactly as they were before: accepted on the strength of the other checks.
 * That is the honest degradation, and it is the right way round — the
 * alternative, rejecting what cannot be verified, empties the totals of every
 * author this browser has not happened to pay.
 */

/**
 * lightning address -> every key its receipts have been seen signed with.
 *
 * Keyed by the whole address, not by the domain, and that distinction is the
 * bug this file was written with. One LNbits instance signs with a *different*
 * key per pay link — `kk@ln.nostrfeed.com` answers with one `nostrPubkey` and
 * `help@ln.nostrfeed.com` on the same host answers with another. Caching one
 * key for the domain therefore rejected every receipt for every other address
 * on it, which is precisely "zaps from our own server stopped counting".
 *
 * A list rather than one key, because they also rotate: LNbits regenerates the
 * keypair when the extension is reinstalled, and receipts signed by the old
 * key are not forgeries, they are last month's zaps.
 *
 * Forging still requires a key that address actually published at some point,
 * so this is strictly stronger than the check being skipped.
 */
export type ProviderTable = Record<string, string[]>;

const providersKey = defineKey<ProviderTable>('nostr:zap-providers', {});

/**
 * How many addresses to remember.
 *
 * One entry is an address and a key or two, and the useful set is whoever this
 * browser has actually paid.
 */
export const MAX_PROVIDERS = 500;

/** How many past keys to keep per address. Rotations are rare. */
export const MAX_KEYS_PER_ADDRESS = 4;

/** A BIP-340 key, which is what a `nostrPubkey` must be to be usable. */
function isValidNostrPubkey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/**
 * The address, in the one form it is stored under.
 *
 * Lowercased whole: a domain is case-insensitive, and LUD-16 local parts are
 * specified lowercase, so `Alice@GetZap.me` must not be remembered separately
 * from `alice@getzap.me`.
 */
export function providerAddress(address: string | undefined): string | null {
  if (!address) return null;

  const trimmed = address.trim().toLowerCase();
  const match = /^([^\s@/]+)@([^\s@/]+)$/.exec(trimmed);
  if (!match) return null;

  if (!match[2].includes('.')) return null;

  return trimmed;
}

/** The host part, for showing rather than for keying. */
export function providerDomain(address: string | undefined): string | null {
  return providerAddress(address)?.split('@')[1] ?? null;
}

/**
 * The stored keys for an entry, whatever shape the entry is in.
 *
 * Storage outlives a release. An install from before this held a bare string
 * here, and the array code went straight to `.filter` on it — which threw on
 * the first zap anybody sent, taking the send with it. Anything unrecognised
 * reads as no keys rather than as a crash.
 */
function readKeys(value: unknown): string[] {
  if (typeof value === 'string') return isValidNostrPubkey(value) ? [value] : [];
  if (!Array.isArray(value)) return [];

  return value.filter(isValidNostrPubkey);
}

/**
 * Records the key an address signs with, learned from its payment offer.
 *
 * Returns whether anything was stored, so a caller can tell a new address from
 * one already known.
 */
export function rememberProvider(
  address: string | undefined,
  nostrPubkey: unknown
): boolean {
  const entry = providerAddress(address);
  if (!entry || !isValidNostrPubkey(nostrPubkey)) return false;

  const key = nostrPubkey.toLowerCase();
  const held = readKeys(readStore(providersKey)[entry]);

  if (held[0] === key) return false;

  writeStore(providersKey, (current) => {
    // Newest first, and the old ones kept: a rotation must not invalidate
    // every receipt this address signed before it
    const keys = [key, ...readKeys(current[entry]).filter((k) => k !== key)]
      .slice(0, MAX_KEYS_PER_ADDRESS);

    const next: ProviderTable = { ...current, [entry]: keys };
    const entries = Object.keys(next);

    if (entries.length <= MAX_PROVIDERS) return next;

    /*
     * Oldest-first eviction is not available — the table is a plain map and
     * insertion order is all there is — but that is close enough here. The
     * cost of evicting the wrong entry is one address's receipts going back to
     * being unverified until somebody zaps it again.
     */
    const trimmed: ProviderTable = {};
    for (const name of entries.slice(entries.length - MAX_PROVIDERS)) {
      trimmed[name] = readKeys(next[name]);
    }
    return trimmed;
  });

  return true;
}

/**
 * The keys to check a receipt against, or undefined when this address has
 * never been met.
 *
 * Undefined is not a failure and callers must not treat it as one: it means
 * "no opinion", and the receipt is then judged on the checks that do not need
 * a network round trip.
 */
export function providerKeyFor(
  address: string | undefined
): string[] | undefined {
  const entry = providerAddress(address);
  if (!entry) return undefined;

  const keys = readKeys(readStore(providersKey)[entry]);

  // Undefined rather than an empty list: "no opinion" and "no key matches"
  // must not be the same answer
  return keys.length ? keys : undefined;
}

/**
 * The provider key a note's receipts should be checked against, if any.
 *
 * Withheld when the money went to more than one person. A note with an
 * Appendix G zap split pays several recipients at several addresses, and
 * checking all of their receipts against one address's keys would reject
 * everyone else — turning a correct split into a note that earned nothing.
 */
export function providerKeyForRecipients(
  recipients: readonly string[],
  address: string | undefined
): string[] | undefined {
  if (recipients.length !== 1) return undefined;

  return providerKeyFor(address);
}

/** Every address known, for showing how much of the network can be verified. */
export function knownProviders(): ProviderTable {
  return { ...readStore(providersKey) };
}

/** Forgets everything. For tests, which share a module instance. */
export function resetProviders(): void {
  writeStore(providersKey, {});
}
