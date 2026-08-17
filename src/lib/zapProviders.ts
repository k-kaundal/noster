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
 * app already makes — every zap sent, every payment offer resolved — and keyed
 * by domain, because one server answers for all of its addresses. Zapping one
 * person at getzap.me teaches us how to verify receipts for everyone there.
 *
 * The consequence is a cache that fills where the app is used. A domain nobody
 * here has ever paid stays unknown, and receipts from it are treated exactly
 * as they were before: accepted on the strength of the other checks. That is
 * the honest degradation — the alternative, rejecting what we cannot verify,
 * would empty the totals of every author whose server we happen not to have
 * met yet.
 */

/**
 * domain -> every key its receipts have been seen signed with, newest first.
 *
 * A list rather than one key, because servers rotate them. LNbits regenerates
 * the Nostr Zaps keypair when the extension is reinstalled or reconfigured,
 * and receipts signed by the old key are not forgeries — they are last month's
 * zaps. Holding one key meant a rotation silently invalidated every zap the
 * server had ever signed, which reads exactly like "our own zaps stopped
 * counting".
 *
 * Forging still requires a key the server actually published at some point, so
 * this is strictly stronger than the check being skipped.
 */
export type ProviderTable = Record<string, string[]>;

const providersKey = defineKey<ProviderTable>('nostr:zap-providers', {});

/**
 * How many domains to remember.
 *
 * Small: one entry is a domain and 64 hex characters, and the useful set is
 * the handful of lightning servers most of Nostr actually uses.
 */
export const MAX_PROVIDERS = 200;

/** How many past keys to keep per domain. Rotations are rare. */
export const MAX_KEYS_PER_DOMAIN = 4;

/** A BIP-340 key, which is what a `nostrPubkey` must be to be usable. */
function isValidNostrPubkey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/**
 * The server that answers for a lightning address.
 *
 * Lowercased, since a domain is case-insensitive and `Alice@GetZap.me` must
 * not be remembered separately from `alice@getzap.me`.
 */
export function providerDomain(address: string | undefined): string | null {
  if (!address) return null;

  const match = /^[^\s@/]+@([^\s@/]+)$/.exec(address.trim().toLowerCase());
  if (!match) return null;

  const domain = match[1];
  if (!domain.includes('.')) return null;

  return domain;
}

/**
 * Records the key a server signs with, learned from its payment offer.
 *
 * Returns whether anything was stored, so a caller can tell a new domain from
 * one already known.
 */
export function rememberProvider(
  address: string | undefined,
  nostrPubkey: unknown
): boolean {
  const domain = providerDomain(address);
  if (!domain || !isValidNostrPubkey(nostrPubkey)) return false;

  const key = nostrPubkey.toLowerCase();
  const table = readStore(providersKey);

  if (table[domain]?.[0] === key) return false;

  writeStore(providersKey, (current) => {
    // Newest first, and the old ones kept: a rotation must not invalidate
    // every receipt the server signed before it
    const held = current[domain] ?? [];
    const keys = [key, ...held.filter((held) => held !== key)].slice(
      0,
      MAX_KEYS_PER_DOMAIN
    );

    const next: ProviderTable = { ...current, [domain]: keys };
    const domains = Object.keys(next);

    if (domains.length <= MAX_PROVIDERS) return next;

    /*
     * Oldest-first eviction is not available — the table is a plain map and
     * insertion order is all there is — but that is close enough here. The
     * cost of evicting the wrong entry is one domain's receipts going back to
     * being unverified until somebody zaps there again.
     */
    const trimmed: ProviderTable = {};
    for (const name of domains.slice(domains.length - MAX_PROVIDERS)) {
      trimmed[name] = next[name];
    }
    return trimmed;
  });

  return true;
}

/**
 * The key to check a receipt against, or undefined when this server has never
 * been met.
 *
 * Undefined is not a failure and callers must not treat it as one: it means
 * "no opinion", and the receipt is then judged on the checks that do not need
 * a network round trip.
 */
export function providerKeyFor(
  address: string | undefined
): string[] | undefined {
  const domain = providerDomain(address);
  if (!domain) return undefined;

  const keys = readStore(providersKey)[domain];

  // Undefined rather than an empty list: "no opinion" and "no key matches"
  // must not be the same answer
  return keys?.length ? keys : undefined;
}

/**
 * The provider key a note's receipts should be checked against, if any.
 *
 * Withheld when the money went to more than one person. A note with an
 * Appendix G zap split pays several recipients who may well be on different
 * lightning servers, and checking all of their receipts against one server's
 * key would reject everyone not on it — turning a correct split into a note
 * that appears to have earned nothing.
 */
export function providerKeyForRecipients(
  recipients: readonly string[],
  address: string | undefined
): string[] | undefined {
  if (recipients.length !== 1) return undefined;

  return providerKeyFor(address);
}

/** Every server known, for showing how much of the network can be verified. */
export function knownProviders(): ProviderTable {
  return { ...readStore(providersKey) };
}

/** Forgets everything. For tests, which share a module instance. */
export function resetProviders(): void {
  writeStore(providersKey, {});
}
