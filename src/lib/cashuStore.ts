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
const PRIVKEY_KEY = 'cashu:nutzap-key';
const LOG_KEY = 'cashu:movements';

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

/**
 * The key nutzaps to this wallet are locked to (NIP-60 `privkey`).
 *
 * Kept here, per identity, because it must never change once published. The
 * wallet event is replaceable, so publishing a second one with a freshly
 * generated key silently retires the first — and any nutzap already locked to
 * the old key becomes money this wallet can no longer claim.
 *
 * That was reachable. The event is only created when a relay query comes back
 * with no existing one, and an empty result is not proof of absence: one relay,
 * a four second timeout, and a wallet that does exist reads as a wallet that
 * does not. Generating the key here instead makes the republish harmless,
 * because it republishes the same key.
 */
export function walletPrivkey(
  pubkey: string,
  mintUrl: string,
  generate: () => string
): string {
  const all = read<string>(PRIVKEY_KEY);
  const key = slot(pubkey, mintUrl);

  const existing = all[key];
  if (typeof existing === 'string' && /^[0-9a-f]{64}$/.test(existing)) {
    return existing;
  }

  const created = generate();
  all[key] = created;
  write(PRIVKEY_KEY, all);

  return created;
}

/** Adopts the key from a wallet event that already exists on the relays. */
export function rememberWalletPrivkey(
  pubkey: string,
  mintUrl: string,
  privkey: string
): void {
  if (!/^[0-9a-f]{64}$/.test(privkey)) return;

  const all = read<string>(PRIVKEY_KEY);
  all[slot(pubkey, mintUrl)] = privkey;
  write(PRIVKEY_KEY, all);
}

/** Forgets everything about one identity's ecash. Used when signing out. */
export function clearCashu(pubkey: string): void {
  for (const key of [PROOFS_KEY, USED_KEY, QUOTES_KEY, PRIVKEY_KEY]) {
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

/**
 * What each movement of ecash actually was.
 *
 * A NIP-60 kind 7376 records a direction and an amount and nothing else, which
 * is why the history could say "+10,000 sats" and not "minted at
 * mint.nostrfeed.com". Minting, melting, sending a token and receiving one all
 * look identical in it.
 *
 * So the type is written down here at the moment the action is taken, by the
 * code that is taking it and therefore knows. Local to the device — a movement
 * made elsewhere shows up from the Nostr history as unlabelled rather than
 * being guessed at.
 */
export type MovementType =
  | 'cashu_mint'
  | 'cashu_melt'
  | 'cashu_send'
  | 'cashu_receive';

export interface CashuMovement {
  id: string;
  type: MovementType;
  mint: string;
  amountSats: number;
  feeSats?: number;
  status: 'pending' | 'settled' | 'failed';
  /** NUT-04 mint quote or NUT-05 melt quote, whichever applies. */
  quoteId?: string;
  invoice?: string;
  /**
   * The `cashuB…` string, for a token this wallet cut.
   *
   * Kept because the string is the money until somebody redeems it. Without a
   * copy, closing the tab after creating one strands the sats in a token
   * nobody holds — the mint still has them and no wallet can claim them.
   * Keeping it also makes the token re-showable, and re-claimable when the
   * person it was meant for never took it.
   */
  token?: string;
  /** What the token was for, when one was given. */
  memo?: string;
  createdAt: number;
  settledAt?: number;
}

/** How many movements to keep per identity. */
const LOG_LIMIT = 300;

export function readMovements(pubkey: string): CashuMovement[] {
  return read<CashuMovement[]>(LOG_KEY)[pubkey] ?? [];
}

export function recordMovement(
  pubkey: string,
  movement: Omit<CashuMovement, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: number;
  }
): CashuMovement {
  const all = read<CashuMovement[]>(LOG_KEY);

  const entry: CashuMovement = {
    ...movement,
    id: movement.id ?? `cashu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: movement.createdAt ?? Math.floor(Date.now() / 1000),
  };

  /**
   * Replaced by id rather than appended, so settling a deposit updates the row
   * it started as instead of leaving a pending twin above it forever.
   */
  const rest = (all[pubkey] ?? []).filter((item) => item.id !== entry.id);

  all[pubkey] = [entry, ...rest].slice(0, LOG_LIMIT);
  write(LOG_KEY, all);

  return entry;
}

/** Marks a recorded movement settled, keeping everything already known. */
export function settleMovement(
  pubkey: string,
  id: string,
  patch: Partial<Pick<CashuMovement, 'amountSats' | 'feeSats' | 'quoteId'>> = {}
): void {
  const all = read<CashuMovement[]>(LOG_KEY);
  const existing = (all[pubkey] ?? []).find((item) => item.id === id);
  if (!existing) return;

  recordMovement(pubkey, {
    ...existing,
    ...patch,
    status: 'settled',
    settledAt: Math.floor(Date.now() / 1000),
  });
}
