import type { Proof } from '@cashu/cashu-ts';
import { parseProofs, toWireProofs } from '@/lib/cashu';

/**
 * Where ecash actually lives.
 *
 * A proof is the money — there is no account at the mint to fall back on, so
 * losing this storage loses the balance. That is why every write here is
 * mirrored to Nostr (see `nip60.ts`): this file is the fast copy, not the only
 * one.
 *
 * Read and written directly rather than through `useLocalStorage`, because
 * balances change inside mutations, where a React state snapshot taken at
 * mount is exactly the stale value that would overwrite a fresh proof set.
 */
const PROOFS_KEY = 'cashu:proofs';
const USED_KEY = 'cashu:used';
const QUOTES_KEY = 'cashu:quotes';

/** How many spent secrets to remember. Enough to outlive any relay's copy. */
const USED_LIMIT = 2000;

/** One wallet per Nostr identity per mint. */
function slot(pubkey: string, mintUrl: string): string {
  return `${pubkey}:${mintUrl}`;
}

function read<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, T>)
      : {};
  } catch {
    return {};
  }
}

function write<T>(key: string, value: Record<string, T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or disabled. The Nostr backup is the copy that matters.
  }
}

export function readProofs(pubkey: string, mintUrl: string): Proof[] {
  return parseProofs(read<unknown>(PROOFS_KEY)[slot(pubkey, mintUrl)]);
}

export function writeProofs(
  pubkey: string,
  mintUrl: string,
  proofs: Proof[]
): void {
  const all = read<unknown>(PROOFS_KEY);
  all[slot(pubkey, mintUrl)] = toWireProofs(proofs);
  write(PROOFS_KEY, all);
}

/**
 * Secrets that have left this wallet, whether spent at the mint or handed to
 * someone in a token.
 *
 * Kept because a relay still holds the backup those proofs were in. Without
 * this list, every reload would resurrect them: the mint reports a token
 * nobody has redeemed yet as unspent, so a balance already given away would
 * be counted again.
 */
export function readUsedSecrets(pubkey: string, mintUrl: string): Set<string> {
  return new Set(read<string[]>(USED_KEY)[slot(pubkey, mintUrl)] ?? []);
}

export function addUsedSecrets(
  pubkey: string,
  mintUrl: string,
  secrets: string[]
): void {
  if (!secrets.length) return;

  const all = read<string[]>(USED_KEY);
  const key = slot(pubkey, mintUrl);
  const merged = [...(all[key] ?? []), ...secrets];

  // Oldest first, so trimming drops the ones whose relay copies are long gone
  all[key] = merged.slice(Math.max(0, merged.length - USED_LIMIT));
  write(USED_KEY, all);
}

/**
 * A mint quote that has been shown to someone but not yet turned into proofs.
 *
 * The gap between "invoice paid" and "proofs issued" is the one place a
 * deposit can be lost by closing a tab: the mint holds sats against a quote id
 * that only this browser knows. Persisting it means the next visit can finish
 * the job.
 */
export interface PendingQuote {
  /** Quote id at the mint. */
  quote: string;
  amountSats: number;
  /** The bolt11 invoice to pay. */
  request: string;
  /** Unix seconds, or null when the mint sets no expiry. */
  expiry: number | null;
  createdAt: number;
}

export function readQuotes(pubkey: string, mintUrl: string): PendingQuote[] {
  const list = read<PendingQuote[]>(QUOTES_KEY)[slot(pubkey, mintUrl)] ?? [];
  const now = Math.floor(Date.now() / 1000);

  // An expired quote can never be paid or claimed, so it is only clutter
  return list.filter((quote) => !quote.expiry || quote.expiry > now);
}

export function addQuote(
  pubkey: string,
  mintUrl: string,
  quote: PendingQuote
): void {
  const all = read<PendingQuote[]>(QUOTES_KEY);
  const key = slot(pubkey, mintUrl);
  all[key] = [
    quote,
    ...(all[key] ?? []).filter((q) => q.quote !== quote.quote),
  ].slice(0, 20);
  write(QUOTES_KEY, all);
}

export function removeQuote(
  pubkey: string,
  mintUrl: string,
  quoteId: string
): void {
  const all = read<PendingQuote[]>(QUOTES_KEY);
  const key = slot(pubkey, mintUrl);
  all[key] = (all[key] ?? []).filter((q) => q.quote !== quoteId);
  write(QUOTES_KEY, all);
}

/** Forgets everything about one identity's ecash. Used when signing out. */
export function clearCashu(pubkey: string): void {
  for (const key of [PROOFS_KEY, USED_KEY, QUOTES_KEY]) {
    const all = read<unknown>(key);
    let changed = false;

    for (const slotKey of Object.keys(all)) {
      if (slotKey.startsWith(`${pubkey}:`)) {
        delete all[slotKey];
        changed = true;
      }
    }

    if (changed) write(key, all);
  }
}
